import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  expectDatabaseError,
  insertReference,
  requireTables,
  withTestDatabase,
} from "../helpers/schema-database";

test("chapters are translation/book scoped and canonical book order is persisted", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, ["bible_chapters"]);
    await insertReference(db);
    await db.execute(
      sql`update bible_books set sort_order = 1 where translation_id = 'fixture-a'`,
    );
    expect(
      (
        await db.execute(
          sql`select id, sort_order from bible_books order by sort_order`,
        )
      ).rows,
    ).toEqual([{ id: "fixture(book)", sort_order: 1 }]);
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`insert into bible_chapters (translation_id, book_id, id) values ('fixture-b', 'fixture(book)', '10')`,
        ),
      ),
      "23503",
    );
  }));

test("chapter identifiers and assigned chapter positions are unique within their book", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, ["bible_chapters"]);
    await insertReference(db);
    await db.execute(
      sql`update bible_chapters set sort_order = 10 where translation_id = 'fixture-a'`,
    );
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`insert into bible_chapters (translation_id, book_id, id) values ('fixture-a', 'fixture(book)', '10')`,
        ),
      ),
      "23505",
    );
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`insert into bible_chapters (translation_id, book_id, id, sort_order) values ('fixture-a', 'fixture(book)', '11', 10)`,
        ),
      ),
      "23505",
    );
  }));

test("a verse requires a real chapter and chapter deletion cannot discard verses", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, ["bible_chapters"]);
    await insertReference(db);
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`insert into bible_verses (translation_id, book_id, chapter, verse, text) values ('fixture-a', 'fixture(book)', '11', '1', 'Fixture')`,
        ),
      ),
      "23503",
    );
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(
          sql`delete from bible_chapters where translation_id = 'fixture-a'`,
        ),
      ),
      "23503",
    );
  }));
