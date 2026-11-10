import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  expectDatabaseError,
  insertReference,
  requireTables,
  verseId,
  withTestDatabase,
} from "../helpers/schema-database";

const tables = ["bible_books", "bible_verses"];

test("catalogue storage preserves identifiers, translation, text and annotations", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, tables);
    await insertReference(db);
    const result = await db.execute(
      sql`select translation_id, book_id, chapter, verse, text from bible_verses where id = ${verseId}`,
    );
    expect(result.rows).toEqual([
      {
        translation_id: "fixture-a",
        book_id: "fixture(book)",
        chapter: "10",
        verse: "2a",
        text: "Fixture text. ¶ annotation",
      },
    ]);
  }));

test("book identifiers are unique within a translation", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, tables);
    await insertReference(db);
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`insert into bible_books (translation_id, id, name) values ('fixture-a', 'fixture(book)', 'Duplicate')`,
        ),
      ),
      "23505",
    );
  }));

test("verse references are unique within a translation", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, tables);
    await insertReference(db);
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`insert into bible_verses (translation_id, book_id, chapter, verse, text) values ('fixture-a', 'fixture(book)', '10', '2a', 'Duplicate')`,
        ),
      ),
      "23505",
    );
  }));

test("the same book and reference can exist in a different translation", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, tables);
    await insertReference(db);
    await db.execute(
      sql`insert into bible_books (translation_id, id, name) values ('fixture-b', 'fixture(book)', 'Other fixture')`,
    );
    await db.execute(
      sql`insert into bible_chapters (translation_id, book_id, id) values ('fixture-b', 'fixture(book)', '10')`,
    );
    await db.execute(
      sql`insert into bible_verses (translation_id, book_id, chapter, verse, text) values ('fixture-b', 'fixture(book)', '10', '2a', 'Other fixture text')`,
    );
    expect((await db.execute(sql`select id from bible_verses`)).rowCount).toBe(
      2,
    );
  }));

test("a verse must reference a book in its own translation", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, tables);
    await insertReference(db);
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`insert into bible_verses (translation_id, book_id, chapter, verse, text) values ('fixture-b', 'fixture(book)', '10', '2a', 'Orphan')`,
        ),
      ),
      "23503",
    );
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`insert into bible_verses (translation_id, book_id, chapter, verse, text) values ('fixture-a', 'missing', '10', '2a', 'Orphan')`,
        ),
      ),
      "23503",
    );
  }));

test("book deletion cannot silently remove its verses", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, tables);
    await insertReference(db);
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`delete from bible_books where translation_id = 'fixture-a'`,
        ),
      ),
      "23503",
    );
  }));

test("blank catalogue references and text are rejected rather than normalized", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, tables);
    await insertReference(db);
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`insert into bible_verses (translation_id, book_id, chapter, verse, text) values ('fixture-a', 'fixture(book)', '', '3', 'Text')`,
        ),
      ),
      "23514",
    );
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`insert into bible_verses (translation_id, book_id, chapter, verse, text) values ('fixture-a', 'fixture(book)', '10', '3', '   ')`,
        ),
      ),
      "23514",
    );
  }));
