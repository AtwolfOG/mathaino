import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  createReviewService,
  ReviewIneligibleError,
} from "@/application/review";
import { createReviewAttemptStore } from "@/infrastructure/database/review";
import {
  aliceId,
  asFixtureUser,
  bobId,
  insertLearning,
  insertReference,
  insertSchedule,
  insertUser,
  itemId,
  withTestDatabase,
  type TestTransaction,
} from "../helpers/schema-database";

const authentication = (userId: string) => ({ getUserId: async () => userId });
const command = (
  text = "Fixture text annotation",
  operationId = "40000000-0000-4000-8000-000000000040",
) => ({ itemId, operationId, text });

async function prepare(db: TestTransaction, timeZone = "Etc/UTC") {
  await insertUser(db);
  await insertReference(db);
  await insertLearning(db, aliceId, itemId, "mastered");
  await asFixtureUser(db, aliceId, (tx) =>
    tx.execute(sql`
      insert into learning_preferences (user_id, time_zone)
      values (${aliceId}, ${timeZone})
    `),
  );
  await insertSchedule(db);
  await asFixtureUser(db, aliceId, (tx) =>
    tx.execute(sql`
      update review_schedules
      set next_due_at = '2026-01-02T12:00:00Z',
          policy_id = 'fixed-review-ladder-v1'
      where learning_item_id = ${itemId}
    `),
  );
}

test("a successful due review advances its interval and preserves mastery history", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    const service = createReviewService(
      createReviewAttemptStore(db, {
        now: () => new Date("2026-01-02T12:00:00Z"),
      }),
    );

    const result = await service.submit(authentication(aliceId), command());

    expect(result).toMatchObject({
      status: "recorded",
      evaluation: { passed: true },
      schedule: {
        stage: 1,
        intervalDays: 3,
        nextDueAt: "2026-01-05T12:00:00.000Z",
      },
    });
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (
          await tx.execute(sql`
            select state from learning_items where id = ${itemId}
          `)
        ).rows,
      ).toEqual([{ state: "mastered" }]);
      expect(
        (
          await tx.execute(sql`
            select purpose, outcome, time_zone from practice_attempts
          `)
        ).rows,
      ).toEqual([
        { purpose: "review", outcome: "success", time_zone: "Etc/UTC" },
      ]);
      expect(
        (await tx.execute(sql`select * from learning_success_days`)).rows,
      ).toEqual([]);
      expect(
        (
          await tx.execute(sql`
            select count(*)::int as count from daily_practice_completions
          `)
        ).rows,
      ).toEqual([{ count: 1 }]);
    });
  }));

test("a failed review resets the interval without changing mastery", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await asFixtureUser(db, aliceId, (tx) =>
      tx.execute(sql`
        update review_schedules set interval_stage = 4
        where learning_item_id = ${itemId}
      `),
    );
    const service = createReviewService(
      createReviewAttemptStore(db, {
        now: () => new Date("2026-01-02T13:00:00Z"),
      }),
    );

    const result = await service.submit(
      authentication(aliceId),
      command("incorrect words"),
    );

    expect(result).toMatchObject({
      evaluation: { passed: false },
      schedule: {
        stage: 0,
        intervalDays: 1,
        nextDueAt: "2026-01-03T13:00:00.000Z",
      },
    });
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (
          await tx.execute(sql`
            select state from learning_items where id = ${itemId}
          `)
        ).rows,
      ).toEqual([{ state: "mastered" }]);
      expect(
        (await tx.execute(sql`select outcome from practice_attempts`)).rows,
      ).toEqual([{ outcome: "failure" }]);
    });
  }));

test("an overdue review remains eligible and anchors its next due date at acceptance", () =>
  withTestDatabase(async (db) => {
    await prepare(db, "America/New_York");
    const service = createReviewService(
      createReviewAttemptStore(db, {
        now: () => new Date("2026-03-07T17:30:00Z"),
      }),
    );

    const result = await service.submit(authentication(aliceId), command());

    expect(result.schedule).toEqual({
      stage: 1,
      intervalDays: 3,
      nextDueAt: "2026-03-10T16:30:00.000Z",
    });
  }));

test("a review before its exact due instant is rejected without losing the schedule", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    const service = createReviewService(
      createReviewAttemptStore(db, {
        now: () => new Date("2026-01-02T11:59:59.999Z"),
      }),
    );

    await expect(
      service.submit(authentication(aliceId), command()),
    ).rejects.toBeInstanceOf(ReviewIneligibleError);
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (
          await tx.execute(
            sql`select count(*)::int as count from practice_attempts`,
          )
        ).rows,
      ).toEqual([{ count: 0 }]);
      expect(
        (
          await tx.execute(sql`
            select next_due_at = '2026-01-02T12:00:00Z'::timestamptz as unchanged
            from review_schedules
          `)
        ).rows,
      ).toEqual([{ unchanged: true }]);
    });
  }));

test("retrying one operation records and schedules the review exactly once", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    const service = createReviewService(
      createReviewAttemptStore(db, {
        now: () => new Date("2026-01-02T12:00:00Z"),
      }),
    );

    const first = await service.submit(authentication(aliceId), command());
    const retry = await service.submit(authentication(aliceId), command());

    expect(first.status).toBe("recorded");
    expect(retry.status).toBe("duplicate");
    expect(retry.schedule).toEqual(first.schedule);
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (
          await tx.execute(sql`
            select
              (select count(*)::int from practice_attempts) as attempts,
              interval_stage
            from review_schedules
          `)
        ).rows,
      ).toEqual([{ attempts: 1, interval_stage: 1 }]);
    });
  }));

test("successive accepted reviews preserve every outcome in attempt history", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    let now = new Date("2026-01-02T12:00:00Z");
    const service = createReviewService(
      createReviewAttemptStore(db, { now: () => now }),
    );
    await service.submit(authentication(aliceId), command());
    now = new Date("2026-01-05T12:00:00Z");
    await service.submit(
      authentication(aliceId),
      command("incorrect words", "40000000-0000-4000-8000-000000000041"),
    );

    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (
          await tx.execute(sql`
            select purpose, outcome, practiced_at::text
            from practice_attempts
            order by practiced_at
          `)
        ).rows,
      ).toEqual([
        {
          purpose: "review",
          outcome: "success",
          practiced_at: "2026-01-02 12:00:00+00",
        },
        {
          purpose: "review",
          outcome: "failure",
          practiced_at: "2026-01-05 12:00:00+00",
        },
      ]);
      expect(
        (
          await tx.execute(sql`
            select interval_stage,
              next_due_at = '2026-01-06T12:00:00Z'::timestamptz as expected
            from review_schedules
          `)
        ).rows,
      ).toEqual([{ interval_stage: 0, expected: true }]);
    });
  }));

test("another owner cannot review a mastered item", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await insertUser(db, bobId);
    const service = createReviewService(
      createReviewAttemptStore(db, {
        now: () => new Date("2026-01-02T12:00:00Z"),
      }),
    );

    await expect(
      service.submit(authentication(bobId), command()),
    ).rejects.toThrow("Review item not found.");
  }));
