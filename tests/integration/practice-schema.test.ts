import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  aliceId,
  asFixtureUser,
  attemptId,
  bobId,
  expectDatabaseError,
  insertAttempt,
  insertCompletion,
  insertLearning,
  insertReference,
  insertSchedule,
  insertUser,
  itemId,
  missingId,
  operationId,
  otherAttemptId,
  otherItemId,
  requireTables,
  withTestDatabase,
  type TestTransaction,
} from "../helpers/schema-database";

const tables = [
  "practice_attempts",
  "daily_practice_completions",
  "review_schedules",
];

async function prepare(db: TestTransaction) {
  await requireTables(db, tables);
  await insertUser(db);
  await insertReference(db);
  await insertLearning(db, aliceId, itemId, "mastered");
}

test("attempts preserve explicit outcome, time and policy context without raw recordings", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertAttempt(db);
    await asFixtureUser(db, aliceId, async (tx) => {
      const result = await tx.execute(
        sql`select mode, purpose, outcome, practice_date::text, time_zone, assessment_policy from practice_attempts`,
      );
      expect(result.rows).toEqual([
        {
          mode: "typing",
          purpose: "learning",
          outcome: "success",
          practice_date: "2026-01-01",
          time_zone: "Etc/UTC",
          assessment_policy: "fixture-assessment-v1",
        },
      ]);
    });
  }));

test("operation identities are unique per user, not globally", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertAttempt(db);
    await expectDatabaseError(
      insertAttempt(db, aliceId, itemId, otherAttemptId),
      "23505",
    );
    await insertUser(db, bobId);
    await insertLearning(db, bobId, otherItemId);
    await insertAttempt(db, bobId, otherItemId, otherAttemptId, operationId);
  }));

test("attempts cannot reference a missing item or another owner's item", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertUser(db, bobId);
    await expectDatabaseError(insertAttempt(db, aliceId, missingId), "23503");
    await expectDatabaseError(insertAttempt(db, bobId), "23503");
  }));

test("technical errors and unsupported modes cannot be stored as assessed results", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertAttempt(db);
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (tx) =>
        tx.execute(sql`update practice_attempts set outcome = 'network-error'`),
      ),
      "23514",
    );
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (tx) =>
        tx.execute(sql`update practice_attempts set mode = 'unsupported-mode'`),
      ),
      "23514",
    );
  }));

test("a practice day can be completed at most once per user", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertAttempt(db);
    await insertCompletion(db);
    await expectDatabaseError(insertCompletion(db), "23505");
  }));

test("day completion must reference an attempt by the same owner on the same day", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertUser(db, bobId);
    await insertAttempt(db);
    await expectDatabaseError(insertCompletion(db, bobId), "23503");
    await expectDatabaseError(
      insertCompletion(db, aliceId, missingId),
      "23503",
    );
    await expectDatabaseError(
      insertCompletion(db, aliceId, attemptId, "2026-01-02"),
      "23503",
    );
  }));

test("a mastered item has at most one review schedule with an explicit due instant", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertSchedule(db);
    await expectDatabaseError(insertSchedule(db), "23505");
    await asFixtureUser(db, aliceId, async (tx) => {
      const result = await tx.execute(
        sql`select next_due_at = '2026-01-08T12:00:00Z'::timestamptz as same_instant, pg_typeof(next_due_at)::text as column_type from review_schedules`,
      );
      expect(result.rows).toEqual([
        { same_instant: true, column_type: "timestamp with time zone" },
      ]);
    });
  }));

test("schedules cannot cross owners or exist for an unmastered item", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertUser(db, bobId);
    await insertLearning(db, bobId, otherItemId);
    await expectDatabaseError(insertSchedule(db, bobId), "23503");
    await expectDatabaseError(insertSchedule(db, bobId, otherItemId), "23503");
  }));

test("demotion must remove its schedule in the same transaction", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertSchedule(db);
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (tx) =>
        tx.execute(
          sql`update learning_items set state = 'learning', mastered_at = null where id = ${itemId}`,
        ),
      ),
      "23503",
    );
    await asFixtureUser(db, aliceId, async (tx) => {
      await tx.execute(
        sql`delete from review_schedules where learning_item_id = ${itemId}`,
      );
      await tx.execute(
        sql`update learning_items set state = 'learning', mastered_at = null where id = ${itemId}`,
      );
    });
  }));

test("successful transactions retain attempt and completion together", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await db.transaction(async (tx) => {
      await insertAttempt(tx);
      await insertCompletion(tx);
    });
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (await tx.execute(sql`select id from practice_attempts`)).rows,
      ).toEqual([{ id: attemptId }]);
      expect(
        (
          await tx.execute(
            sql`select source_attempt_id from daily_practice_completions`,
          )
        ).rows,
      ).toEqual([{ source_attempt_id: attemptId }]);
    });
  }));

test("application failure rolls back attempts and their completion", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await expect(
      db.transaction(async (tx) => {
        await insertAttempt(tx);
        await insertCompletion(tx);
        throw new Error("Fixture abort");
      }),
    ).rejects.toThrow("Fixture abort");
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (await tx.execute(sql`select id from practice_attempts`)).rows,
      ).toEqual([]);
      expect(
        (await tx.execute(sql`select user_id from daily_practice_completions`))
          .rows,
      ).toEqual([]);
    });
  }));

test("constraint failure rolls back earlier statements instead of partially crediting practice", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await expectDatabaseError(
      db.transaction(async (tx) => {
        await insertAttempt(tx);
        await insertCompletion(tx, aliceId, missingId);
      }),
      "23503",
    );
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (await tx.execute(sql`select id from practice_attempts`)).rows,
      ).toEqual([]);
    });
  }));

test("deleting an account cascades through its private practice graph", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertAttempt(db);
    await insertCompletion(db);
    await insertSchedule(db);
    await asFixtureUser(db, aliceId, async (tx) => {
      await tx.execute(sql`delete from users where id = ${aliceId}`);
      for (const name of tables) {
        expect(
          (await tx.execute(sql`select * from ${sql.identifier(name)}`)).rows,
        ).toEqual([]);
      }
    });
    expect((await db.execute(sql`select id from bible_verses`)).rowCount).toBe(
      1,
    );
  }));
