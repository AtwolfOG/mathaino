import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  aliceId,
  asFixtureUser,
  bobId,
  expectDatabaseError,
  insertLearning,
  insertReference,
  insertUser,
  itemId,
  missingId,
  otherItemId,
  requireTables,
  verseId,
  withTestDatabase,
} from "../helpers/schema-database";

test("a user has at most one learning item per verse, while users remain independent", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, ["learning_items"]);
    await insertUser(db);
    await insertUser(db, bobId);
    await insertReference(db);
    await insertLearning(db);
    await expectDatabaseError(
      insertLearning(db, aliceId, otherItemId),
      "23505",
    );
    await insertLearning(db, bobId, otherItemId);
    await asFixtureUser(db, bobId, async (scoped) => {
      expect(
        (
          await scoped.execute(
            sql`select id from learning_items where user_id = ${bobId}`,
          )
        ).rows,
      ).toEqual([{ id: otherItemId }]);
    });
  }));

test("learning items require existing users and verses", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, ["learning_items"]);
    await insertReference(db);
    await expectDatabaseError(insertLearning(db, missingId), "23503");
    await insertUser(db);
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (tx) =>
        tx.execute(
          sql`insert into learning_items (user_id, verse_id) values (${aliceId}, ${missingId})`,
        ),
      ),
      "23503",
    );
  }));

test("mastery state and its timestamp must agree", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, ["learning_items"]);
    await insertUser(db);
    await insertReference(db);
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (tx) =>
        tx.execute(
          sql`insert into learning_items (user_id, verse_id, state) values (${aliceId}, ${verseId}, 'mastered')`,
        ),
      ),
      "23514",
    );
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (tx) =>
        tx.execute(
          sql`insert into learning_items (user_id, verse_id, state) values (${aliceId}, ${verseId}, 'invented-state')`,
        ),
      ),
      "23514",
    );
    await insertLearning(db, aliceId, itemId, "mastered");
  }));

test("learning items accept only valid optional mastery threshold overrides", () =>
  withTestDatabase(async (db) => {
    await insertUser(db);
    await insertReference(db);
    await asFixtureUser(db, aliceId, (tx) =>
      tx.execute(sql`
        insert into learning_items
          (id, user_id, verse_id, mastery_threshold_override)
        values (${itemId}, ${aliceId}, ${verseId}, 30)
      `),
    );
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (tx) =>
        tx.execute(sql`
          update learning_items
          set mastery_threshold_override = 0
          where id = ${itemId}
        `),
      ),
      "23514",
    );
  }));

test("reference deletion cannot destroy learning progress", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, ["learning_items"]);
    await insertUser(db);
    await insertReference(db);
    await insertLearning(db);
    await expectDatabaseError(
      db.transaction((tx) =>
        tx.execute(sql`delete from bible_verses where id = ${verseId}`),
      ),
      "23503",
    );
  }));

test("user deletion removes only that user's items and preserves the catalogue", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, ["learning_items"]);
    await insertUser(db);
    await insertUser(db, bobId);
    await insertReference(db);
    await insertLearning(db);
    await insertLearning(db, bobId, otherItemId);
    await asFixtureUser(db, aliceId, (tx) =>
      tx.execute(sql`delete from users where id = ${aliceId}`),
    );
    await asFixtureUser(db, bobId, async (tx) => {
      expect(
        (await tx.execute(sql`select id from learning_items`)).rows,
      ).toEqual([{ id: otherItemId }]);
    });
    expect((await db.execute(sql`select id from bible_verses`)).rows).toEqual([
      { id: verseId },
    ]);
  }));
