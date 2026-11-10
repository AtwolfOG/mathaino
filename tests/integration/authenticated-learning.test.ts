import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { createDatabase } from "@/infrastructure/database/client";
import { applyMigrations } from "@/infrastructure/database/migrate";
import { users } from "@/infrastructure/database/schema";
import { createAuthentication } from "@/infrastructure/authentication/service";
import { createAuthenticationContext } from "@/infrastructure/authentication/context";
import { createLearningReader } from "@/infrastructure/database/learning-reader";
import { handleLearningRequest } from "@/ui/http/learning";
import { withUserDatabase } from "@/infrastructure/database/with-user";
import {
  authTestEnvironment,
  cookieHeader,
  login,
  register,
} from "../helpers/authentication";
import {
  attemptId,
  insertAttempt,
  insertCompletion,
  insertLearning,
  insertReference,
  insertSchedule,
  itemId,
  otherAttemptId,
  otherItemId,
  withTestDatabase,
  type TestTransaction,
} from "../helpers/schema-database";
import type { AuthenticationContext } from "@/application/authentication-context";

async function withAccounts(
  run: (
    db: TestTransaction,
    alice: AuthenticationContext,
    bob: AuthenticationContext,
    anonymous: AuthenticationContext,
  ) => Promise<void>,
) {
  const config = authTestEnvironment();
  const owner = createDatabase(config.databaseURL);
  const connection = createDatabase(config.authDatabaseURL);
  const emails = [
    `auth-integration-${randomUUID()}@example.test`,
    `auth-integration-${randomUUID()}@example.test`,
  ];
  try {
    await applyMigrations(owner.db);
    // This suite commits two synthetic accounts to test cross-connection identity.
    // Only abuse counters in the explicit, serialized test store are reset.
    await connection.db.execute(sql`delete from auth_rate_limits`);
    const service = createAuthentication(connection.db, config);
    const contexts: AuthenticationContext[] = [];
    for (const email of emails) {
      await register(service, email);
      const response = await login(service, email);
      expect(response.status).toBe(200);
      contexts.push(
        createAuthenticationContext(
          service,
          new Headers({ cookie: cookieHeader(response) }),
        ),
      );
    }
    const alice = contexts[0];
    const bob = contexts[1];
    if (!alice || !bob) throw new Error("Missing fixture context");
    const anonymous = createAuthenticationContext(service, new Headers());
    await withTestDatabase(async (db) => {
      const aliceId = await alice.getUserId();
      const bobId = await bob.getUserId();
      expect(aliceId).toEqual(expect.any(String));
      expect(bobId).toEqual(expect.any(String));
      if (!aliceId || !bobId)
        throw new Error("Missing verified fixture identity");
      await insertReference(db);
      await insertLearning(db, aliceId, itemId, "mastered");
      await insertLearning(db, bobId, otherItemId, "mastered");
      await insertAttempt(db, aliceId, itemId, attemptId);
      await insertAttempt(db, bobId, otherItemId, otherAttemptId);
      await insertCompletion(db, aliceId, attemptId);
      await insertCompletion(db, bobId, otherAttemptId);
      await insertSchedule(db, aliceId, itemId);
      await insertSchedule(db, bobId, otherItemId);
      await withUserDatabase(db, alice, (tx) =>
        tx.execute(
          sql`insert into learning_preferences (user_id, current_learning_item_id) values (${aliceId}, ${itemId})`,
        ),
      );
      await withUserDatabase(db, bob, (tx) =>
        tx.execute(
          sql`insert into learning_preferences (user_id, current_learning_item_id) values (${bobId}, ${otherItemId})`,
        ),
      );
      await run(db, alice, bob, anonymous);
    });
  } finally {
    try {
      await connection.db.delete(users).where(inArray(users.email, emails));
      await connection.db.execute(sql`delete from auth_rate_limits`);
    } finally {
      await connection.close();
      await owner.close();
    }
  }
}

test("verified library sessions bind all learning-resource queries to the correct owner", () =>
  withAccounts(async (db, alice, bob, anonymous) => {
    const aliceId = await alice.getUserId();
    const bobId = await bob.getUserId();
    for (const table of [
      "learning_items",
      "learning_preferences",
      "practice_attempts",
      "daily_practice_completions",
      "review_schedules",
    ]) {
      const read = (context: AuthenticationContext) =>
        withUserDatabase(db, context, (tx) =>
          tx.execute(sql`select user_id from ${sql.identifier(table)}`),
        );
      expect((await read(alice)).rows).toEqual([{ user_id: aliceId }]);
      expect((await read(bob)).rows).toEqual([{ user_id: bobId }]);
      await expect(read(anonymous)).rejects.toThrow("Authentication required.");
    }
  }));

test("protected learning reads deny anonymous access, foreign IDs, and malformed owner/route parameters", () =>
  withAccounts(async (db, alice, bob, anonymous) => {
    const reader = createLearningReader(db);
    const request = new Request("https://mathaino.example/api/learning-items");
    expect(
      (await handleLearningRequest(request, reader, anonymous)).status,
    ).toBe(401);
    const own = await handleLearningRequest(request, reader, alice, itemId);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({
      item: { id: itemId, bookName: "Fixture Book" },
    });
    expect(
      (await handleLearningRequest(request, reader, bob, itemId)).status,
    ).toBe(404);
    expect(
      (await handleLearningRequest(request, reader, alice, "invalid-id"))
        .status,
    ).toBe(400);
    expect(
      (
        await handleLearningRequest(
          new Request(`${request.url}?userId=forged-owner`),
          reader,
          alice,
        )
      ).status,
    ).toBe(400);
    const listed = await handleLearningRequest(request, reader, bob);
    expect(listed.headers.get("cache-control")).toBe("private, no-store");
    expect(await listed.json()).toMatchObject({ items: [{ id: otherItemId }] });
  }));
