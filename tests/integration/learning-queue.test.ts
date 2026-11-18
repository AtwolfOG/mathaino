import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { createLearningQueue } from "@/infrastructure/database/learning-queue";
import { createLearningReader } from "@/infrastructure/database/learning-reader";
import {
  aliceId,
  asFixtureUser,
  bobId,
  insertReference,
  insertUser,
  itemId,
  otherItemId,
  verseId,
  withTestDatabase,
  type TestTransaction,
} from "../helpers/schema-database";

const thirdVerseId = "10000000-0000-4000-8000-000000000003";
const fourthVerseId = "10000000-0000-4000-8000-000000000004";
const thirdItemId = "20000000-0000-4000-8000-000000000003";
const fourthItemId = "20000000-0000-4000-8000-000000000004";
const now = new Date("2026-01-10T12:00:00Z");
const authentication = (userId: string | null) => ({
  getUserId: async () => userId,
});

async function prepareQueue(db: TestTransaction) {
  await insertUser(db);
  await insertUser(db, bobId);
  await insertReference(db);
  await db.execute(sql`
    insert into bible_verses
      (id, translation_id, book_id, chapter, verse, text)
    values
      ('10000000-0000-4000-8000-000000000002', 'fixture-a', 'fixture(book)', '10', '3', 'Second.'),
      (${thirdVerseId}, 'fixture-a', 'fixture(book)', '10', '4', 'Due review.'),
      (${fourthVerseId}, 'fixture-a', 'fixture(book)', '10', '5', 'Future review.')
  `);
  await asFixtureUser(db, aliceId, async (scoped) => {
    await scoped.execute(sql`
      insert into learning_items (id, user_id, verse_id)
      values
        (${itemId}, ${aliceId}, ${verseId}),
        (${otherItemId}, ${aliceId}, '10000000-0000-4000-8000-000000000002')
    `);
    await scoped.execute(sql`
      insert into learning_items
        (id, user_id, verse_id, state, mastered_at)
      values
        (${thirdItemId}, ${aliceId}, ${thirdVerseId}, 'mastered', '2026-01-01T12:00:00Z'),
        (${fourthItemId}, ${aliceId}, ${fourthVerseId}, 'mastered', '2026-01-01T12:00:00Z')
    `);
    await scoped.execute(sql`
      insert into review_schedules
        (learning_item_id, user_id, next_due_at, interval_stage, policy_id)
      values
        (${thirdItemId}, ${aliceId}, '2026-01-09T12:00:00Z', 0, 'fixture-v1'),
        (${fourthItemId}, ${aliceId}, '2026-01-11T12:00:00Z', 0, 'fixture-v1')
    `);
  });
}

test("an empty learning queue has zero progress", () =>
  withTestDatabase(async (db) => {
    await insertUser(db);
    const queue = createLearningQueue(db, { now: () => now });
    await expect(queue.read(authentication(aliceId))).resolves.toEqual({
      current: null,
      position: 0,
      total: 0,
      remaining: 0,
      version: 0,
      previousId: null,
      nextId: null,
    });
  }));

test("the queue orders learning items before due reviews and excludes ineligible items", () =>
  withTestDatabase(async (db) => {
    await prepareQueue(db);
    await asFixtureUser(db, aliceId, (scoped) =>
      scoped.execute(sql`
        update learning_items set archived_at = now() where id = ${otherItemId}
      `),
    );
    const queue = createLearningQueue(db, { now: () => now });

    const first = await queue.read(authentication(aliceId));
    expect(first).toMatchObject({
      current: { id: itemId, status: "learning" },
      position: 1,
      total: 2,
      remaining: 1,
      version: 0,
    });
    const moved = await queue.select(authentication(aliceId), thirdItemId, 0);
    expect(moved).toMatchObject({
      status: "updated",
      queue: {
        current: { id: thirdItemId, status: "review-due" },
        position: 2,
        total: 2,
        remaining: 0,
        version: 1,
      },
    });

    const reloaded = createLearningQueue(db, { now: () => now });
    await expect(reloaded.read(authentication(aliceId))).resolves.toMatchObject(
      {
        current: { id: thirdItemId },
        position: 2,
        version: 1,
      },
    );
  }));

test("stale and cross-user queue navigation cannot overwrite progress", () =>
  withTestDatabase(async (db) => {
    await prepareQueue(db);
    const queue = createLearningQueue(db, { now: () => now });
    await expect(
      queue.select(authentication(aliceId), otherItemId, 0),
    ).resolves.toMatchObject({ status: "updated" });
    await expect(
      queue.select(authentication(aliceId), itemId, 0),
    ).resolves.toMatchObject({
      status: "conflict",
      queue: { current: { id: otherItemId }, version: 1 },
    });
    await expect(
      queue.select(authentication(bobId), itemId, 0),
    ).resolves.toMatchObject({
      status: "not-found",
      queue: { current: null, total: 0 },
    });
  }));

test("the learning library distinguishes learning, mastered, due, and archived items", () =>
  withTestDatabase(async (db) => {
    await prepareQueue(db);
    await asFixtureUser(db, aliceId, (scoped) =>
      scoped.execute(sql`
        update learning_items
        set archived_at = now(), mastery_threshold_override = 5
        where id = ${otherItemId}
      `),
    );
    const reader = createLearningReader(db, { now: () => now });
    const items = await reader.list(authentication(aliceId));
    expect(
      items.map(
        ({
          id,
          status,
          archived,
          masteryThreshold,
          defaultMasteryThreshold,
          usesDefaultMasteryThreshold,
        }) => ({
          id,
          status,
          archived,
          masteryThreshold,
          defaultMasteryThreshold,
          usesDefaultMasteryThreshold,
        }),
      ),
    ).toEqual([
      {
        id: itemId,
        status: "learning",
        archived: false,
        masteryThreshold: 3,
        defaultMasteryThreshold: 3,
        usesDefaultMasteryThreshold: true,
      },
      {
        id: otherItemId,
        status: "learning",
        archived: true,
        masteryThreshold: 5,
        defaultMasteryThreshold: 3,
        usesDefaultMasteryThreshold: false,
      },
      {
        id: thirdItemId,
        status: "review-due",
        archived: false,
        masteryThreshold: 3,
        defaultMasteryThreshold: 3,
        usesDefaultMasteryThreshold: true,
      },
      {
        id: fourthItemId,
        status: "mastered",
        archived: false,
        masteryThreshold: 3,
        defaultMasteryThreshold: 3,
        usesDefaultMasteryThreshold: true,
      },
    ]);
  }));
