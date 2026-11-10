import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { writeBibleImport } from "@/infrastructure/database/import-bible";
import { seedReferenceData } from "@/infrastructure/database/seed";
import { parseKjvSnapshot } from "@/infrastructure/bible/kjv-parser";
import { fixtureProfile, firstVerse, snapshot } from "../helpers/kjv-fixture";
import {
  expectDatabaseError,
  withTestDatabase,
} from "../helpers/schema-database";

function data() {
  const result = parseKjvSnapshot(snapshot(), { profile: fixtureProfile });
  if (!result.data) throw new Error("Invalid parser fixture");
  return result.data;
}

test("the import persists books, chapters and exact source verses and verifies all rows", () =>
  withTestDatabase(async (db) => {
    const result = await writeBibleImport(db, data());
    expect(result.inserted).toEqual({ books: 1, chapters: 1, verses: 2 });
    expect(result.verified).toEqual({ books: 1, chapters: 1, verses: 2 });
    expect(
      (
        await db.execute(
          sql`select text from bible_verses where translation_id = 'en-kjv' and verse = '1'`,
        )
      ).rows,
    ).toEqual([{ text: firstVerse.text }]);
    expect(
      (
        await db.execute(
          sql`select id, sort_order from bible_chapters where translation_id = 'en-kjv'`,
        )
      ).rows,
    ).toEqual([{ id: "1", sort_order: 1 }]);
  }));

test("repeated imports insert nothing, keep IDs stable, and do not touch timestamps", () =>
  withTestDatabase(async (db) => {
    await writeBibleImport(db, data());
    const before = (
      await db.execute(
        sql`select id, text, updated_at from bible_verses where translation_id = 'en-kjv' order by verse`,
      )
    ).rows;
    const result = await writeBibleImport(db, data());
    expect(result.inserted).toEqual({ books: 0, chapters: 0, verses: 0 });
    expect(result.orderValuesFilled).toBe(0);
    expect(
      (
        await db.execute(
          sql`select id, text, updated_at from bible_verses where translation_id = 'en-kjv' order by verse`,
        )
      ).rows,
    ).toEqual(before);
  }));

test("translation-scoped imports do not collide with another translation", () =>
  withTestDatabase(async (db) => {
    await writeBibleImport(db, data());
    const other = data();
    other.translationId = "fixture-other";
    for (const rows of [other.books, other.chapters, other.verses])
      for (const row of rows) row.translationId = other.translationId;
    await expect(writeBibleImport(db, other)).resolves.toMatchObject({
      inserted: { books: 1, chapters: 1, verses: 2 },
    });
    expect(
      (
        await db.execute(
          sql`select distinct translation_id from bible_verses order by translation_id`,
        )
      ).rows,
    ).toEqual([
      { translation_id: "en-kjv" },
      { translation_id: "fixture-other" },
    ]);
  }));

test("conflicting existing text rolls back all newly inserted rows and preserves existing data", () =>
  withTestDatabase(async (db) => {
    await writeBibleImport(db, data());
    await db.execute(
      sql`update bible_verses set text = 'Existing fixture text' where translation_id = 'en-kjv' and verse = '1'`,
    );
    const input = data();
    input.books.push({
      translationId: "en-kjv",
      id: "exodus",
      name: "Exodus",
      sortOrder: 2,
    });
    input.chapters.push({
      translationId: "en-kjv",
      bookId: "exodus",
      id: "1",
      sortOrder: 1,
    });
    input.verses.push({
      translationId: "en-kjv",
      bookId: "exodus",
      chapter: "1",
      verse: "1",
      text: "Fixture",
    });
    await expect(writeBibleImport(db, input)).rejects.toThrow(
      "Existing verse differs",
    );
    expect(
      (await db.execute(sql`select id from bible_books where id = 'exodus'`))
        .rows,
    ).toEqual([]);
    expect(
      (
        await db.execute(
          sql`select text from bible_verses where translation_id = 'en-kjv' and verse = '1'`,
        )
      ).rows,
    ).toEqual([{ text: "Existing fixture text" }]);
  }));

test("database reference failures roll back the entire import", () =>
  withTestDatabase(async (db) => {
    const input = data();
    const first = input.verses[0];
    if (!first) throw new Error("Missing fixture");
    first.chapter = "missing";
    await expectDatabaseError(writeBibleImport(db, input), "23503");
    expect(
      (
        await db.execute(
          sql`select id from bible_books where translation_id = 'en-kjv'`,
        )
      ).rows,
    ).toEqual([]);
  }));

test("unexpected stored references are reported rather than deleted or silently accepted", () =>
  withTestDatabase(async (db) => {
    await writeBibleImport(db, data());
    await db.execute(
      sql`insert into bible_verses (translation_id, book_id, chapter, verse, text) values ('en-kjv', 'genesis', '1', '3', 'Existing fixture')`,
    );
    await expect(writeBibleImport(db, data())).rejects.toThrow(
      "Stored verse coverage differs",
    );
    expect(
      (
        await db.execute(
          sql`select id from bible_verses where translation_id = 'en-kjv'`,
        )
      ).rowCount,
    ).toBe(3);
  }));

test("a mixed-translation dataset cannot write outside the requested translation", () =>
  withTestDatabase(async (db) => {
    await writeBibleImport(db, data());
    const input = data();
    const book = input.books[0];
    if (!book) throw new Error("Missing fixture");
    book.translationId = "unrequested-translation";
    await expect(writeBibleImport(db, input)).rejects.toThrow(
      "Mixed translation identifiers",
    );
    expect(
      (
        await db.execute(
          sql`select id from bible_books where translation_id = 'unrequested-translation'`,
        )
      ).rows,
    ).toEqual([]);
  }));

test("legacy matching data receives only missing order metadata without replacing verse identities", () =>
  withTestDatabase(async (db) => {
    const input = data();
    await seedReferenceData(db, {
      books: input.books.map(({ translationId, id, name }) => ({
        translationId,
        id,
        name,
      })),
      verses: input.verses,
    });
    const before = (
      await db.execute(
        sql`select id, text from bible_verses where translation_id = 'en-kjv' order by verse`,
      )
    ).rows;
    const result = await writeBibleImport(db, input);
    expect(result).toMatchObject({
      inserted: { books: 0, chapters: 0, verses: 0 },
      orderValuesFilled: 2,
    });
    expect(
      (
        await db.execute(
          sql`select id, text from bible_verses where translation_id = 'en-kjv' order by verse`,
        )
      ).rows,
    ).toEqual(before);
  }));
