import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { createPracticeProgressReader } from "@/infrastructure/database/practice-progress";
import {
  aliceId,
  asFixtureUser,
  bobId,
  insertLearning,
  insertReference,
  insertUser,
  itemId,
  otherItemId,
  withTestDatabase,
  type TestTransaction,
} from "../helpers/schema-database";

const authentication = (userId: string | null) => ({
  getUserId: async () => userId,
});

async function prepare(db: TestTransaction) {
  await insertUser(db);
  await insertUser(db, bobId);
  await insertReference(db);
  await insertLearning(db);
  await insertLearning(db, bobId, otherItemId);
}

async function insertCompletionHistory(
  db: TestTransaction,
  owner: string,
  learningItem: string,
  dates: readonly string[],
) {
  await asFixtureUser(db, owner, async (tx) => {
    const namespace = owner === aliceId ? "50000000" : "70000000";
    const operationNamespace = owner === aliceId ? "60000000" : "80000000";
    for (const [index, date] of dates.entries()) {
      const attemptId = `${namespace}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const operationId = `${operationNamespace}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      await tx.execute(sql`
        insert into practice_attempts
          (id, user_id, learning_item_id, operation_id, request_hash, mode,
           purpose, outcome, practiced_at, practice_date, time_zone,
           assessment_policy, day_policy)
        values
          (${attemptId}, ${owner}, ${learningItem}, ${operationId}, ${"c".repeat(64)},
           'typing', 'learning', 'success', ${`${date}T12:00:00Z`}, ${date},
           'Etc/UTC', 'fixture-assessment-v1', 'fixture-day-v1')
      `);
      await tx.execute(sql`
        insert into daily_practice_completions
          (user_id, practice_date, source_attempt_id, time_zone, day_policy)
        values (${owner}, ${date}, ${attemptId}, 'Etc/UTC', 'fixture-day-v1')
      `);
    }
  });
}

test("recalculates current and longest streaks from the owner's completion history", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertCompletionHistory(db, aliceId, itemId, [
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-06",
      "2026-01-07",
    ]);
    await insertCompletionHistory(db, bobId, otherItemId, ["2026-01-08"]);
    const reader = createPracticeProgressReader(db, {
      now: () => new Date("2026-01-08T10:00:00Z"),
    });

    await expect(reader.read(authentication(aliceId))).resolves.toEqual({
      currentStreak: 2,
      longestStreak: 3,
      completedToday: false,
    });
  }));

test("uses the current account timezone at the local midnight boundary", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertCompletionHistory(db, aliceId, itemId, [
      "2026-01-01",
      "2026-01-02",
    ]);
    await asFixtureUser(db, aliceId, (tx) =>
      tx.execute(sql`
        insert into learning_preferences (user_id, time_zone)
        values (${aliceId}, 'America/New_York')
      `),
    );

    const beforeMidnight = createPracticeProgressReader(db, {
      now: () => new Date("2026-01-03T04:59:59.999Z"),
    });
    const afterMidnight = createPracticeProgressReader(db, {
      now: () => new Date("2026-01-03T05:00:00.000Z"),
    });
    await expect(beforeMidnight.read(authentication(aliceId))).resolves.toEqual(
      {
        currentStreak: 2,
        longestStreak: 2,
        completedToday: true,
      },
    );
    await expect(afterMidnight.read(authentication(aliceId))).resolves.toEqual({
      currentStreak: 2,
      longestStreak: 2,
      completedToday: false,
    });
  }));

test("reading progress defaults to UTC and does not create a completion", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    const reader = createPracticeProgressReader(db, {
      now: () => new Date("2026-01-03T00:00:00Z"),
    });

    await expect(reader.read(authentication(aliceId))).resolves.toEqual({
      currentStreak: 0,
      longestStreak: 0,
      completedToday: false,
    });
    await asFixtureUser(db, aliceId, async (tx) => {
      const rows = await tx.execute(
        sql`select count(*)::int as count from daily_practice_completions`,
      );
      expect(rows.rows).toEqual([{ count: 0 }]);
    });
  }));

test("progress history requires authentication", () =>
  withTestDatabase(async (db) => {
    const reader = createPracticeProgressReader(db);
    await expect(reader.read(authentication(null))).rejects.toThrow(
      "Authentication required.",
    );
  }));
