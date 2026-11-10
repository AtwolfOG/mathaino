import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { seedReferenceData } from "@/infrastructure/database/seed";
import {
  expectDatabaseError,
  withTestDatabase,
} from "../helpers/schema-database";

// Internal seed contract, not a claim about the source KJV JSON format.
const book = { translationId: "fixture-seed", id: "fixture", name: "Fixture" };
const verse = {
  translationId: "fixture-seed",
  bookId: "fixture",
  chapter: "10",
  verse: "2a",
  text: "Fixture text. ¶ note",
};
const data = { books: [book], verses: [verse] };

test.for([
  null,
  [],
  { books: [], verses: "invalid" },
  { books: [{ ...book, id: " " }], verses: [] },
  { books: [], verses: [{ ...verse, text: 42 }] },
  {
    books: [{ ...book, ignoredField: "must-not-be-silently-lost" }],
    verses: [],
  },
])("seed input is validated before any insertion (%j)", (input) =>
  withTestDatabase(async (db) => {
    await expect(seedReferenceData(db, input)).rejects.toThrow(
      "Invalid reference seed data.",
    );
    expect(
      (
        await db.execute(
          sql`select id from bible_books where translation_id = 'fixture-seed'`,
        )
      ).rows,
    ).toEqual([]);
  }),
);

test("seeding validated reference values preserves source text and is idempotent", () =>
  withTestDatabase(async (db) => {
    await expect(seedReferenceData(db, data)).resolves.toEqual({
      booksInserted: 1,
      versesInserted: 1,
    });
    const before = (
      await db.execute(
        sql`select text, updated_at from bible_verses where translation_id = 'fixture-seed'`,
      )
    ).rows;
    await expect(seedReferenceData(db, data)).resolves.toEqual({
      booksInserted: 0,
      versesInserted: 0,
    });
    const after = (
      await db.execute(
        sql`select text, updated_at from bible_verses where translation_id = 'fixture-seed'`,
      )
    ).rows;
    expect(before[0]?.text).toBe(verse.text);
    expect(after).toEqual(before);
  }));

test("seeding refuses to overwrite an existing book's metadata", () =>
  withTestDatabase(async (db) => {
    await seedReferenceData(db, data);
    await expect(
      seedReferenceData(db, {
        books: [{ ...book, name: "Conflicting name" }],
        verses: [],
      }),
    ).rejects.toThrow("Conflicting existing book.");
    expect(
      (
        await db.execute(
          sql`select name from bible_books where translation_id = 'fixture-seed'`,
        )
      ).rows,
    ).toEqual([{ name: book.name }]);
  }));

test("a conflicting verse rolls back new rows and preserves existing text", () =>
  withTestDatabase(async (db) => {
    await seedReferenceData(db, data);
    await expect(
      seedReferenceData(db, {
        books: [{ ...book, id: "would-be-new" }],
        verses: [{ ...verse, text: "Conflicting text" }],
      }),
    ).rejects.toThrow("Conflicting existing verse.");
    expect(
      (
        await db.execute(
          sql`select id from bible_books where id = 'would-be-new'`,
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.execute(
          sql`select text from bible_verses where translation_id = 'fixture-seed'`,
        )
      ).rows,
    ).toEqual([{ text: verse.text }]);
  }));

test("a seed foreign-key failure rolls back the entire batch", () =>
  withTestDatabase(async (db) => {
    await expectDatabaseError(
      seedReferenceData(db, {
        books: [book],
        verses: [{ ...verse, bookId: "missing" }],
      }),
      "23503",
    );
    expect(
      (
        await db.execute(
          sql`select id from bible_books where translation_id = 'fixture-seed'`,
        )
      ).rows,
    ).toEqual([]);
  }));

test("the default empty seed performs no data import", () =>
  withTestDatabase(async (db) => {
    await expect(
      seedReferenceData(db, { books: [], verses: [] }),
    ).resolves.toEqual({ booksInserted: 0, versesInserted: 0 });
    expect((await db.execute(sql`select id from bible_books`)).rows).toEqual(
      [],
    );
  }));
