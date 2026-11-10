import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { createDatabase } from "@/infrastructure/database/client";
import { applyMigrations } from "@/infrastructure/database/migrate";
import { createLearningWriter } from "@/infrastructure/database/learning-writer";
import { withUserDatabase } from "@/infrastructure/database/with-user";
import { getTestDatabaseUrl } from "../helpers/database-url";

test("concurrent add requests create one owned learning item without changing order", async () => {
  const first = createDatabase(
    getTestDatabaseUrl(process.env.TEST_DATABASE_URL),
  );
  const second = createDatabase(
    getTestDatabaseUrl(process.env.TEST_DATABASE_URL),
  );
  const userId = randomUUID();
  const suffix = randomUUID().replaceAll("-", "");
  const bookId = `concurrency${suffix}`;
  const verseId = randomUUID();
  const authentication = { getUserId: async () => userId };
  try {
    await applyMigrations(first.db);
    await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        insert into users (id, display_name) values (${userId}, 'Concurrent learner')
      `),
    );
    await first.db.execute(sql`
      insert into bible_books (translation_id, id, name)
      values ('en-kjv', ${bookId}, 'Concurrent Book')
    `);
    await first.db.execute(sql`
      insert into bible_chapters (translation_id, book_id, id)
      values ('en-kjv', ${bookId}, '1')
    `);
    await first.db.execute(sql`
      insert into bible_verses
        (id, translation_id, book_id, chapter, verse, text)
      values (${verseId}, 'en-kjv', ${bookId}, '1', '1', 'Concurrent verse.')
    `);
    const reference = [{ bookId, chapterId: "1", verseNumber: "1" }];

    const results = await Promise.all([
      createLearningWriter(first.db).add(authentication, reference),
      createLearningWriter(second.db).add(authentication, reference),
    ]);
    expect(results.map(({ added }) => added).sort()).toEqual([0, 1]);
    expect(results.map(({ existing }) => existing).sort()).toEqual([0, 1]);
    const stored = await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        select count(*)::int as count, min(queue_order) = max(queue_order) as one_order
        from learning_items where user_id = ${userId}
      `),
    );
    expect(stored.rows).toEqual([{ count: 1, one_order: true }]);
  } finally {
    try {
      await withUserDatabase(first.db, authentication, (tx) =>
        tx.execute(sql`delete from users where id = ${userId}`),
      );
      await first.db.execute(
        sql`delete from bible_verses where id = ${verseId}`,
      );
      await first.db.execute(sql`
        delete from bible_chapters
        where translation_id = 'en-kjv' and book_id = ${bookId}
      `);
      await first.db.execute(sql`
        delete from bible_books
        where translation_id = 'en-kjv' and id = ${bookId}
      `);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  }
});
