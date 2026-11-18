import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  createRecitationService,
  RecitationConflictError,
  RecitationNotFoundError,
} from "@/application/recitation";
import { createRecitationAttemptStore } from "@/infrastructure/database/recitation";
import { createLearningQueue } from "@/infrastructure/database/learning-queue";
import {
  aliceId,
  asFixtureUser,
  bobId,
  insertLearning,
  insertReference,
  insertUser,
  itemId,
  withTestDatabase,
  type TestTransaction,
} from "../helpers/schema-database";

const operationId = "40000000-0000-4000-8000-000000000010";
const auth = (userId: string | null) => ({ getUserId: async () => userId });
const command = (text: string, operation = operationId) => ({
  itemId,
  operationId: operation,
  text,
});

async function prepare(db: TestTransaction) {
  await insertUser(db);
  await insertUser(db, bobId);
  await insertReference(db);
  await insertLearning(db);
}

test("successful and failed submissions persist assessed attempts and progress facts", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    const service = createRecitationService(
      createRecitationAttemptStore(db, {
        now: () => new Date("2026-01-02T12:00:00Z"),
      }),
    );

    const success = await service.submit(
      auth(aliceId),
      command("Fixture text annotation"),
    );
    const failure = await service.submit(
      auth(aliceId),
      command("entirely wrong", "40000000-0000-4000-8000-000000000011"),
    );

    expect(success).toMatchObject({
      status: "recorded",
      evaluation: { passed: true, accuracy: 100 },
      progress: {
        consecutiveDays: 1,
        masteryThreshold: 3,
        mastered: false,
        practiceStreak: 1,
      },
    });
    expect(failure).toMatchObject({
      status: "recorded",
      evaluation: { passed: false },
      progress: { consecutiveDays: 1, practiceStreak: 1 },
    });
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (
          await tx.execute(
            sql`select outcome from practice_attempts order by created_at`,
          )
        ).rows,
      ).toEqual([{ outcome: "success" }, { outcome: "failure" }]);
      expect(
        (
          await tx.execute(
            sql`select practice_date::text from learning_success_days`,
          )
        ).rows,
      ).toEqual([{ practice_date: "2026-01-02" }]);
      expect(
        (
          await tx.execute(
            sql`select practice_date::text from daily_practice_completions`,
          )
        ).rows,
      ).toEqual([{ practice_date: "2026-01-02" }]);
    });
  }));

test("persists voice transcripts as voice attempts without storing audio", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    const service = createRecitationService(createRecitationAttemptStore(db));
    await service.submit(auth(aliceId), {
      ...command("Fixture text annotation"),
      mode: "voice",
    });

    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (await tx.execute(sql`select mode from practice_attempts`)).rows,
      ).toEqual([{ mode: "voice" }]);
    });
  }));

test("same-operation retries are idempotent and conflicting reuse is rejected", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    const service = createRecitationService(
      createRecitationAttemptStore(db, {
        now: () => new Date("2026-01-02T12:00:00Z"),
      }),
    );
    const first = await service.submit(
      auth(aliceId),
      command("Fixture text annotation"),
    );
    const duplicate = await service.submit(
      auth(aliceId),
      command("Fixture text annotation"),
    );
    expect(first.status).toBe("recorded");
    expect(duplicate).toMatchObject({
      status: "duplicate",
      evaluation: first.evaluation,
      progress: first.progress,
    });
    await expect(
      service.submit(auth(aliceId), command("different request")),
    ).rejects.toBeInstanceOf(RecitationConflictError);
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (
          await tx.execute(
            sql`select count(*)::int as count from practice_attempts`,
          )
        ).rows,
      ).toEqual([{ count: 1 }]);
    });
  }));

test("intentional retries are separate attempts but cannot duplicate a successful day", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    const service = createRecitationService(
      createRecitationAttemptStore(db, {
        now: () => new Date("2026-01-02T12:00:00Z"),
      }),
    );
    await service.submit(auth(aliceId), command("Fixture text annotation"));
    const retry = await service.submit(
      auth(aliceId),
      command(
        "Fixture text annotation",
        "40000000-0000-4000-8000-000000000012",
      ),
    );
    expect(retry.progress.consecutiveDays).toBe(1);
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (
          await tx.execute(
            sql`select count(*)::int as count from practice_attempts`,
          )
        ).rows,
      ).toEqual([{ count: 2 }]);
      expect(
        (
          await tx.execute(
            sql`select count(*)::int as count from learning_success_days`,
          )
        ).rows,
      ).toEqual([{ count: 1 }]);
    });
  }));

test("three consecutive successful days master the item and schedule its first review", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    let now = new Date("2026-03-07T17:30:00Z");
    const service = createRecitationService(
      createRecitationAttemptStore(db, { now: () => now }),
    );
    await asFixtureUser(db, aliceId, (tx) =>
      tx.execute(sql`
        insert into learning_preferences (user_id, time_zone)
        values (${aliceId}, 'America/New_York')
      `),
    );
    for (let index = 0; index < 3; index += 1) {
      await service.submit(
        auth(aliceId),
        command(
          "Fixture text annotation",
          `40000000-0000-4000-8000-00000000002${index}`,
        ),
      );
      now = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (
          await tx.execute(
            sql`select state from learning_items where id = ${itemId}`,
          )
        ).rows,
      ).toEqual([{ state: "mastered" }]);
      const schedule = await tx.execute(sql`
        select
          next_due_at = '2026-03-10T17:30:00Z'::timestamptz as expected,
          interval_stage,
          policy_id
        from review_schedules where learning_item_id = ${itemId}
      `);
      expect(schedule.rows).toEqual([
        {
          expected: true,
          interval_stage: 0,
          policy_id: "fixed-review-ladder-v1",
        },
      ]);
      expect(
        (
          await tx.execute(sql`
            select
              (select count(*)::int from practice_attempts) as attempts,
              (select count(*)::int from learning_success_days) as success_days
          `)
        ).rows,
      ).toEqual([{ attempts: 3, success_days: 3 }]);
    });
  }));

test("an item mastery threshold override controls its transition", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await asFixtureUser(db, aliceId, (tx) =>
      tx.execute(sql`
        update learning_items
        set mastery_threshold_override = 1
        where id = ${itemId}
      `),
    );
    const service = createRecitationService(
      createRecitationAttemptStore(db, {
        now: () => new Date("2026-01-02T12:00:00Z"),
      }),
    );

    const result = await service.submit(
      auth(aliceId),
      command("Fixture text annotation"),
    );

    expect(result.progress).toMatchObject({
      consecutiveDays: 1,
      masteryThreshold: 1,
      mastered: true,
    });
    await expect(
      createLearningQueue(db, {
        now: () => new Date("2026-01-02T12:00:00Z"),
      }).read(auth(aliceId)),
    ).resolves.toMatchObject({ current: null, total: 0 });
    await expect(
      createLearningQueue(db, {
        now: () => new Date("2026-01-03T12:00:00Z"),
      }).read(auth(aliceId)),
    ).resolves.toMatchObject({
      current: { id: itemId, status: "review-due" },
      total: 1,
    });
  }));

test("a timezone change cannot backfill a missed mastery day", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    await asFixtureUser(db, aliceId, (tx) =>
      tx.execute(sql`
        insert into learning_preferences (user_id, time_zone)
        values (${aliceId}, 'Etc/UTC')
      `),
    );
    let now = new Date("2026-01-01T09:00:00Z");
    const service = createRecitationService(
      createRecitationAttemptStore(db, { now: () => now }),
    );
    await service.submit(
      auth(aliceId),
      command(
        "Fixture text annotation",
        "40000000-0000-4000-8000-000000000030",
      ),
    );
    now = new Date("2026-01-03T09:00:00Z");
    await service.submit(
      auth(aliceId),
      command(
        "Fixture text annotation",
        "40000000-0000-4000-8000-000000000031",
      ),
    );
    await asFixtureUser(db, aliceId, (tx) =>
      tx.execute(sql`
        update learning_preferences
        set time_zone = 'America/Adak'
        where user_id = ${aliceId}
      `),
    );
    now = new Date("2026-01-03T09:30:00Z");
    const result = await service.submit(
      auth(aliceId),
      command(
        "Fixture text annotation",
        "40000000-0000-4000-8000-000000000032",
      ),
    );

    expect(result.progress).toMatchObject({
      consecutiveDays: 1,
      mastered: false,
    });
    await asFixtureUser(db, aliceId, async (tx) => {
      expect(
        (
          await tx.execute(sql`
            select practice_date::text, time_zone
            from practice_attempts
            order by practiced_at
          `)
        ).rows,
      ).toEqual([
        { practice_date: "2026-01-01", time_zone: "Etc/UTC" },
        { practice_date: "2026-01-03", time_zone: "Etc/UTC" },
        { practice_date: "2026-01-02", time_zone: "America/Adak" },
      ]);
      expect(
        (
          await tx.execute(sql`
            select practice_date::text
            from learning_success_days
            order by practice_date
          `)
        ).rows,
      ).toEqual([
        { practice_date: "2026-01-01" },
        { practice_date: "2026-01-03" },
      ]);
    });
  }));

test("foreign learning items are indistinguishable from missing items", () =>
  withTestDatabase(async (db) => {
    await prepare(db);
    const service = createRecitationService(createRecitationAttemptStore(db));
    await expect(
      service.submit(auth(bobId), {
        ...command("Fixture text annotation"),
        mode: "voice",
      }),
    ).rejects.toBeInstanceOf(RecitationNotFoundError);
  }));
