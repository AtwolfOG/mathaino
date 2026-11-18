import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { createLearningWriter } from "@/infrastructure/database/learning-writer";
import {
  aliceId,
  asFixtureUser,
  bobId,
  insertUser,
  withTestDatabase,
  type TestTransaction,
} from "../helpers/schema-database";

const references = [
  { bookId: "genesis", chapterId: "1", verseNumber: "1" },
  { bookId: "genesis", chapterId: "1", verseNumber: "2" },
];

async function insertLearningFixture(database: TestTransaction) {
  await insertUser(database, aliceId);
  await insertUser(database, bobId);
  await database.execute(sql`
    insert into bible_books (translation_id, id, name, sort_order)
    values ('en-kjv', 'genesis', 'Genesis', 1)
  `);
  await database.execute(sql`
    insert into bible_chapters (translation_id, book_id, id, sort_order)
    values ('en-kjv', 'genesis', '1', 1)
  `);
  await database.execute(sql`
    insert into bible_verses (id, translation_id, book_id, chapter, verse, text)
    values
      ('10000000-0000-4000-8000-000000000001', 'en-kjv', 'genesis', '1', '1', 'Verse one.'),
      ('10000000-0000-4000-8000-000000000002', 'en-kjv', 'genesis', '1', '2', 'Verse two.')
  `);
}

const authentication = (userId: string | null) => ({
  getUserId: async () => userId,
});

test("selected verses persist once per authenticated learner without resetting progress", () =>
  withTestDatabase(async (database) => {
    await insertLearningFixture(database);
    const writer = createLearningWriter(database);

    await expect(
      writer.add(authentication(aliceId), references),
    ).resolves.toEqual({
      added: 2,
      existing: 0,
      restored: 0,
    });
    await asFixtureUser(database, aliceId, (scoped) =>
      scoped.execute(sql`
        update learning_items set state = 'mastered', mastered_at = now()
        where user_id = ${aliceId} and verse_id = '10000000-0000-4000-8000-000000000001'
      `),
    );
    await expect(
      writer.add(authentication(aliceId), [references[0]!, references[0]!]),
    ).resolves.toEqual({ added: 0, existing: 1, restored: 0 });

    const stored = await asFixtureUser(database, aliceId, (scoped) =>
      scoped.execute(sql`
        select state from learning_items where user_id = ${aliceId} order by verse_id
      `),
    );
    expect(stored.rows).toEqual([{ state: "mastered" }, { state: "learning" }]);
  }));

test("archiving preserves progress, re-adding restores it, and deletion starts fresh", () =>
  withTestDatabase(async (database) => {
    await insertLearningFixture(database);
    const writer = createLearningWriter(database);
    await writer.add(authentication(aliceId), [references[0]!]);
    const stored = await asFixtureUser(database, aliceId, (scoped) =>
      scoped.execute(sql`
        select id from learning_items where user_id = ${aliceId}
      `),
    );
    const id = String(stored.rows[0]?.id);

    await expect(
      writer.remove(authentication(bobId), id, "archive"),
    ).resolves.toBeNull();
    await expect(
      writer.remove(authentication(aliceId), id, "archive"),
    ).resolves.toBe("archive");
    await expect(
      writer.add(authentication(aliceId), [references[0]!]),
    ).resolves.toEqual({ added: 0, existing: 0, restored: 1 });

    await writer.setRemovalPolicy(authentication(aliceId), "delete");
    await expect(
      writer.getRemovalPolicy(authentication(aliceId)),
    ).resolves.toBe("delete");
    await expect(writer.remove(authentication(aliceId), id)).resolves.toBe(
      "delete",
    );
    await expect(
      writer.add(authentication(aliceId), [references[0]!]),
    ).resolves.toEqual({ added: 1, existing: 0, restored: 0 });
  }));

test("learning saves reject anonymous and invalid references atomically", () =>
  withTestDatabase(async (database) => {
    await insertLearningFixture(database);
    const writer = createLearningWriter(database);

    await expect(writer.add(authentication(null), references)).rejects.toThrow(
      "Authentication required.",
    );
    await expect(
      writer.add(authentication(aliceId), [
        references[0]!,
        { bookId: "genesis", chapterId: "1", verseNumber: "999" },
      ]),
    ).rejects.toThrow("Bible verse not found.");
    const stored = await asFixtureUser(database, aliceId, (scoped) =>
      scoped.execute(
        sql`select id from learning_items where user_id = ${aliceId}`,
      ),
    );
    expect(stored.rows).toEqual([]);
  }));

test("the same verse can belong independently to different learners", () =>
  withTestDatabase(async (database) => {
    await insertLearningFixture(database);
    const writer = createLearningWriter(database);

    await writer.add(authentication(aliceId), [references[0]!]);
    await writer.add(authentication(bobId), [references[0]!]);

    const aliceItems = await asFixtureUser(database, aliceId, (scoped) =>
      scoped.execute(sql`select user_id from learning_items`),
    );
    const bobItems = await asFixtureUser(database, bobId, (scoped) =>
      scoped.execute(sql`select user_id from learning_items`),
    );
    expect(aliceItems.rows).toEqual([{ user_id: aliceId }]);
    expect(bobItems.rows).toEqual([{ user_id: bobId }]);
  }));

test("an owner can set or clear an item mastery threshold override", () =>
  withTestDatabase(async (database) => {
    await insertLearningFixture(database);
    const writer = createLearningWriter(database);
    await writer.add(authentication(aliceId), [references[0]!]);
    const stored = await asFixtureUser(database, aliceId, (scoped) =>
      scoped.execute(sql`select id from learning_items`),
    );
    const id = String(stored.rows[0]?.id);

    await expect(
      writer.setMasteryThresholdOverride(authentication(bobId), id, 5),
    ).resolves.toBe(false);
    await expect(
      writer.setMasteryThresholdOverride(authentication(aliceId), id, 5),
    ).resolves.toBe(true);
    await expect(
      writer.setMasteryThresholdOverride(authentication(aliceId), id, null),
    ).resolves.toBe(true);
    await expect(
      writer.setMasteryThresholdOverride(authentication(aliceId), id, 0),
    ).rejects.toThrow("Mastery threshold must be an integer from 1 to 30.");
  }));
