import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  aliceId,
  asFixtureUser,
  attemptId,
  bobId,
  expectDatabaseError,
  fixtureTime,
  insertAttempt,
  insertCompletion,
  insertLearning,
  insertReference,
  insertSchedule,
  insertUser,
  itemId,
  missingId,
  otherAttemptId,
  otherItemId,
  withTestDatabase,
  type TestTransaction,
} from "../helpers/schema-database";

const privateTables = [
  "users",
  "auth_accounts",
  "auth_sessions",
  "learning_items",
  "learning_preferences",
  "practice_attempts",
  "learning_success_days",
  "daily_practice_completions",
  "review_schedules",
];
const mutableTables = [
  ...privateTables.filter(
    (name) =>
      ![
        "practice_attempts",
        "learning_success_days",
        "daily_practice_completions",
      ].includes(name),
  ),
  "bible_books",
  "bible_verses",
];

async function prepare(db: TestTransaction) {
  await insertReference(db);
  for (const [owner, item, attempt, hash] of [
    [aliceId, itemId, attemptId, "c".repeat(64)],
    [bobId, otherItemId, otherAttemptId, "d".repeat(64)],
  ] as const) {
    await insertUser(db, owner);
    await insertLearning(db, owner, item, "mastered");
    await insertAttempt(db, owner, item, attempt);
    await insertCompletion(db, owner, attempt);
    await insertSchedule(db, owner, item);
    await asFixtureUser(db, owner, async (tx) => {
      await tx.execute(
        sql`insert into auth_accounts (user_id, provider, provider_account_id, created_at, updated_at) values (${owner}, 'fixture', ${owner}, ${fixtureTime}, ${fixtureTime})`,
      );
      await tx.execute(
        sql`insert into auth_sessions (user_id, token_hash, created_at, updated_at, expires_at) values (${owner}, ${hash}, ${fixtureTime}, ${fixtureTime}, '2027-01-01T12:00:00Z')`,
      );
      await tx.execute(sql`
        insert into learning_success_days
          (user_id, learning_item_id, practice_date, source_attempt_id, time_zone, day_policy)
        values (${owner}, ${item}, '2026-01-01', ${attempt}, 'Etc/UTC', 'fixture-day-v1')
      `);
      await tx.execute(sql`
        insert into learning_preferences
          (user_id, current_learning_item_id, created_at, updated_at)
        values (${owner}, ${item}, ${fixtureTime}, ${fixtureTime})
      `);
    });
  }
}

test.each(privateTables)("unauthenticated queries cannot list %s", (name) =>
  withTestDatabase(async (db) => {
    await prepare(db);
    expect(
      (await db.execute(sql`select * from ${sql.identifier(name)}`)).rows,
    ).toEqual([]);
  }),
);

test.each(privateTables)(
  "owner-scoped queries cannot read another user's %s",
  (name) =>
    withTestDatabase(async (db) => {
      await prepare(db);
      await asFixtureUser(db, aliceId, async (tx) => {
        const ownerColumn = name === "users" ? "id" : "user_id";
        const all = await tx.execute(
          sql`select ${sql.identifier(ownerColumn)} as owner_id from ${sql.identifier(name)}`,
        );
        expect(all.rows).toEqual([{ owner_id: aliceId }]);
        const other = await tx.execute(
          sql`select * from ${sql.identifier(name)} where ${sql.identifier(ownerColumn)} = ${bobId}`,
        );
        expect(other.rows).toEqual([]);
      });
    }),
);

test.each(privateTables)(
  "cross-user updates and deletes cannot touch %s",
  (name) =>
    withTestDatabase(async (db) => {
      await prepare(db);
      await asFixtureUser(db, aliceId, async (tx) => {
        const ownerColumn = name === "users" ? "id" : "user_id";
        expect(
          (
            await tx.execute(
              sql`update ${sql.identifier(name)} set ${sql.identifier(ownerColumn)} = ${sql.identifier(ownerColumn)} where ${sql.identifier(ownerColumn)} = ${bobId} returning *`,
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await tx.execute(
              sql`delete from ${sql.identifier(name)} where ${sql.identifier(ownerColumn)} = ${bobId} returning *`,
            )
          ).rows,
        ).toEqual([]);
      });
      await asFixtureUser(db, bobId, async (tx) => {
        expect(
          (await tx.execute(sql`select * from ${sql.identifier(name)}`))
            .rowCount,
        ).toBe(1);
      });
    }),
);

test("private inserts require authentication even when their foreign keys are valid", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(sql`insert into users (id) values (${missingId})`),
      ),
      "42501",
    );
  }));

test("an authenticated context cannot create records for another owner or transfer ownership", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (tx) =>
        tx.execute(
          sql`insert into auth_accounts (user_id, provider, provider_account_id) values (${bobId}, 'fixture', 'forged-owner')`,
        ),
      ),
      "42501",
    );
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (tx) =>
        tx.execute(
          sql`update auth_accounts set user_id = ${bobId} where user_id = ${aliceId}`,
        ),
      ),
      "42501",
    );
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (tx) =>
        tx.execute(
          sql`insert into auth_sessions (user_id, token_hash, created_at, expires_at) values (${bobId}, ${"e".repeat(64)}, ${fixtureTime}, '2027-01-01T12:00:00Z')`,
        ),
      ),
      "42501",
    );
  }));

test("table ownership does not bypass row-level security", () =>
  withTestDatabase(async (db) => {
    const result = await db.execute(
      sql`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in (${sql.join(
        privateTables.map((name) => sql`${name}`),
        sql`, `,
      )}) and c.relrowsecurity and c.relforcerowsecurity order by relname`,
    );
    expect(result.rows.map((row) => row.relname)).toEqual(
      [...privateTables].sort(),
    );
  }));

test.each(mutableTables)(
  "SQL updates refresh %s.updated_at and preserve created_at",
  (name) =>
    withTestDatabase(async (db) => {
      await prepare(db);
      await asFixtureUser(db, aliceId, async (tx) => {
        const result = await tx.execute(
          sql`update ${sql.identifier(name)} set updated_at = updated_at returning updated_at > ${fixtureTime}::timestamptz as refreshed, created_at = ${fixtureTime}::timestamptz as preserved`,
        );
        expect(result.rows).toEqual([{ refreshed: true, preserved: true }]);
      });
    }),
);
