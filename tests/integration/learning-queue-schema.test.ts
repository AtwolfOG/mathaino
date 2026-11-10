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
  otherItemId,
  requireTables,
  withTestDatabase,
} from "../helpers/schema-database";

test("learning items receive a stable queue order and can be archived", () =>
  withTestDatabase(async (db) => {
    await insertUser(db);
    await insertReference(db);
    await db.execute(sql`
      insert into bible_verses
        (id, translation_id, book_id, chapter, verse, text)
      values
        ('10000000-0000-4000-8000-000000000002', 'fixture-a',
         'fixture(book)', '10', '3', 'Second fixture text.')
    `);
    await insertLearning(db);
    await asFixtureUser(db, aliceId, (scoped) =>
      scoped.execute(sql`
        insert into learning_items (id, user_id, verse_id)
        values (
          ${otherItemId},
          ${aliceId},
          '10000000-0000-4000-8000-000000000002'
        )
      `),
    );

    const rows = await asFixtureUser(db, aliceId, (scoped) =>
      scoped.execute(sql`
        select id, queue_order, archived_at
        from learning_items
        order by queue_order
      `),
    );
    expect(rows.rows).toEqual([
      { id: itemId, queue_order: expect.any(String), archived_at: null },
      { id: otherItemId, queue_order: expect.any(String), archived_at: null },
    ]);
    expect(BigInt(String(rows.rows[1]?.queue_order))).toBeGreaterThan(
      BigInt(String(rows.rows[0]?.queue_order)),
    );

    await asFixtureUser(db, aliceId, (scoped) =>
      scoped.execute(sql`
        update learning_items set archived_at = now() where id = ${itemId}
      `),
    );
  }));

test("learning preferences default safely and cannot point at another owner's item", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, ["learning_preferences"]);
    await insertUser(db);
    await insertUser(db, bobId);
    await insertReference(db);
    await insertLearning(db);
    await insertLearning(db, bobId, otherItemId);

    await asFixtureUser(db, aliceId, (scoped) =>
      scoped.execute(sql`
        insert into learning_preferences (user_id, current_learning_item_id)
        values (${aliceId}, ${itemId})
      `),
    );
    const preferences = await asFixtureUser(db, aliceId, (scoped) =>
      scoped.execute(sql`
        select removal_policy, current_learning_item_id, queue_version
        from learning_preferences
      `),
    );
    expect(preferences.rows).toEqual([
      {
        removal_policy: "archive",
        current_learning_item_id: itemId,
        queue_version: "0",
      },
    ]);

    await expectDatabaseError(
      asFixtureUser(db, aliceId, (scoped) =>
        scoped.execute(sql`
          update learning_preferences
          set current_learning_item_id = ${otherItemId}
          where user_id = ${aliceId}
        `),
      ),
      "23503",
    );
    await expectDatabaseError(
      asFixtureUser(db, aliceId, (scoped) =>
        scoped.execute(sql`
          update learning_preferences set removal_policy = 'invented'
          where user_id = ${aliceId}
        `),
      ),
      "23514",
    );
  }));
