import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { withUserDatabase } from "@/infrastructure/database/with-user";
import {
  aliceId,
  asFixtureUser,
  bobId,
  fixtureTime,
  insertUser,
  withTestDatabase,
} from "../helpers/schema-database";

test("database ownership is derived from trusted authentication and does not leak between scopes", () =>
  withTestDatabase(async (db) => {
    await insertUser(db);
    await insertUser(db, bobId);
    for (const id of [aliceId, bobId]) {
      const result = await withUserDatabase(
        db,
        { getUserId: async () => id },
        (tx) => tx.execute(sql`select id from users`),
      );
      expect(result.rows).toEqual([{ id }]);
      expect((await db.execute(sql`select id from users`)).rows).toEqual([]);
    }
  }));

test("a missing authenticated identity cannot execute private database work", () =>
  withTestDatabase(async (db) => {
    await expect(
      withUserDatabase(db, { getUserId: async () => null }, (tx) =>
        tx.execute(sql`select 1`),
      ),
    ).rejects.toThrow("Authentication required.");
  }));

test("a malformed trusted identity is rejected before setting SQL context", () =>
  withTestDatabase(async (db) => {
    await expect(
      withUserDatabase(db, { getUserId: async () => "invalid-id" }, (tx) =>
        tx.execute(sql`select 1`),
      ),
    ).rejects.toThrow("Invalid authenticated user identifier.");
  }));

test("callback failure rolls back writes and restores the previous database context", () =>
  withTestDatabase(async (db) => {
    await insertUser(db);
    await expect(
      withUserDatabase(db, { getUserId: async () => aliceId }, async (tx) => {
        await tx.execute(
          sql`insert into auth_sessions (user_id, token_hash, created_at, expires_at) values (${aliceId}, ${"f".repeat(64)}, ${fixtureTime}, '2027-01-01T12:00:00Z')`,
        );
        throw new Error("Fixture operation failed");
      }),
    ).rejects.toThrow("Fixture operation failed");
    expect((await db.execute(sql`select id from users`)).rows).toEqual([]);
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (await tx.execute(sql`select id from auth_sessions`)).rows,
      ).toEqual([]);
    });
  }));
