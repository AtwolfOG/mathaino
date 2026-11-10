import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { createBibleReader } from "@/infrastructure/database/bible-reader";
import {
  withTestDatabase,
  type TestTransaction,
} from "../helpers/schema-database";

async function insertReaderFixture(database: TestTransaction) {
  await database.execute(sql`
    insert into bible_books (translation_id, id, name, sort_order)
    values
      ('en-kjv', 'exodus', 'Exodus', 2),
      ('en-kjv', 'genesis', 'Genesis', 1)
  `);
  await database.execute(sql`
    insert into bible_chapters (translation_id, book_id, id, sort_order)
    values
      ('en-kjv', 'genesis', '2', 2),
      ('en-kjv', 'exodus', '1', 1),
      ('en-kjv', 'genesis', '1', 1)
  `);
  await database.execute(sql`
    insert into bible_verses (id, translation_id, book_id, chapter, verse, text)
    values
      ('10000000-0000-4000-8000-000000000010', 'en-kjv', 'genesis', '1', '10', 'Verse ten.'),
      ('10000000-0000-4000-8000-000000000002', 'en-kjv', 'genesis', '1', '2', 'Verse two.'),
      ('10000000-0000-4000-8000-000000000001', 'en-kjv', 'genesis', '1', '1', 'Verse one. ¶ Preserve this note.'),
      ('10000000-0000-4000-8000-000000000011', 'en-kjv', 'genesis', '2', '1', 'Genesis two.'),
      ('10000000-0000-4000-8000-000000000012', 'en-kjv', 'exodus', '1', '1', 'Exodus one.')
  `);
}

test("book and chapter queries preserve imported canonical ordering", () =>
  withTestDatabase(async (database) => {
    await insertReaderFixture(database);
    const reader = createBibleReader(database);

    await expect(reader.listBooks()).resolves.toEqual([
      { id: "genesis", name: "Genesis", firstChapterId: "1" },
      { id: "exodus", name: "Exodus", firstChapterId: "1" },
    ]);
    await expect(reader.listChapters("genesis")).resolves.toEqual([
      { id: "1" },
      { id: "2" },
    ]);
  }));

test("a chapter query returns exact text, numeric verse order, and adjacent chapters", () =>
  withTestDatabase(async (database) => {
    await insertReaderFixture(database);
    const reader = createBibleReader(database);

    const first = await reader.getChapter({
      bookId: "genesis",
      chapterId: "1",
    });
    expect(first).toMatchObject({
      book: { id: "genesis", name: "Genesis" },
      chapterId: "1",
      previous: null,
      next: { bookId: "genesis", chapterId: "2" },
    });
    expect(first?.verses.map(({ number, text }) => ({ number, text }))).toEqual(
      [
        { number: "1", text: "Verse one. ¶ Preserve this note." },
        { number: "2", text: "Verse two." },
        { number: "10", text: "Verse ten." },
      ],
    );

    await expect(
      reader.getChapter({ bookId: "exodus", chapterId: "1" }),
    ).resolves.toMatchObject({
      previous: { bookId: "genesis", chapterId: "2" },
      next: null,
    });
  }));

test("missing and invalid Bible references return no fabricated result", () =>
  withTestDatabase(async (database) => {
    await insertReaderFixture(database);
    const reader = createBibleReader(database);

    await expect(reader.listChapters("missing")).resolves.toBeNull();
    await expect(
      reader.getChapter({ bookId: "genesis", chapterId: "0" }),
    ).resolves.toBeNull();
    await expect(
      reader.getChapter({ bookId: "../genesis", chapterId: "1" }),
    ).resolves.toBeNull();
    await expect(
      reader.getChapter({ bookId: "genesis", chapterId: "999" }),
    ).resolves.toBeNull();
  }));
