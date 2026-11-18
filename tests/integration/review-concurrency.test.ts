import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  createReviewService,
  ReviewIneligibleError,
} from "@/application/review";
import { createDatabase } from "@/infrastructure/database/client";
import { applyMigrations } from "@/infrastructure/database/migrate";
import { createReviewAttemptStore } from "@/infrastructure/database/review";
import { withUserDatabase } from "@/infrastructure/database/with-user";
import { getTestDatabaseUrl } from "../helpers/database-url";

test("concurrent review commands advance one due schedule exactly once", async () => {
  const first = createDatabase(
    getTestDatabaseUrl(process.env.TEST_DATABASE_URL),
  );
  const second = createDatabase(
    getTestDatabaseUrl(process.env.TEST_DATABASE_URL),
  );
  const userId = randomUUID();
  const verseId = randomUUID();
  const itemId = randomUUID();
  const suffix = randomUUID().replaceAll("-", "");
  const bookId = `review${suffix}`;
  const authentication = { getUserId: async () => userId };
  const now = new Date("2026-01-02T12:00:00Z");
  const command = (operationId: string) => ({
    itemId,
    operationId,
    text: "Concurrent review verse",
  });
  try {
    await applyMigrations(first.db);
    await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        insert into users (id, display_name)
        values (${userId}, 'Concurrent reviewer')
      `),
    );
    await first.db.execute(sql`
      insert into bible_books (translation_id, id, name)
      values ('en-kjv', ${bookId}, 'Review Book')
    `);
    await first.db.execute(sql`
      insert into bible_chapters (translation_id, book_id, id)
      values ('en-kjv', ${bookId}, '1')
    `);
    await first.db.execute(sql`
      insert into bible_verses
        (id, translation_id, book_id, chapter, verse, text)
      values (${verseId}, 'en-kjv', ${bookId}, '1', '1', 'Concurrent review verse')
    `);
    await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        insert into learning_items
          (id, user_id, verse_id, state, mastered_at)
        values (${itemId}, ${userId}, ${verseId}, 'mastered', ${now})
      `),
    );
    await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        insert into review_schedules
          (learning_item_id, user_id, next_due_at, interval_stage, policy_id)
        values (${itemId}, ${userId}, ${now}, 0, 'fixed-review-ladder-v1')
      `),
    );
    const firstService = createReviewService(
      createReviewAttemptStore(first.db, { now: () => now }),
    );
    const secondService = createReviewService(
      createReviewAttemptStore(second.db, { now: () => now }),
    );

    const replayOperationId = randomUUID();
    const replayResults = await Promise.all([
      firstService.submit(authentication, command(replayOperationId)),
      secondService.submit(authentication, command(replayOperationId)),
    ]);
    expect(replayResults.map(({ status }) => status).sort()).toEqual([
      "duplicate",
      "recorded",
    ]);

    await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        update review_schedules
        set next_due_at = ${now}, interval_stage = 1
        where learning_item_id = ${itemId}
      `),
    );
    const distinctResults = await Promise.allSettled([
      firstService.submit(authentication, command(randomUUID())),
      secondService.submit(authentication, command(randomUUID())),
    ]);
    expect(distinctResults.map(({ status }) => status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejected = distinctResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(ReviewIneligibleError);

    const stored = await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        select
          (select count(*)::int from practice_attempts) as attempts,
          interval_stage
        from review_schedules
        where learning_item_id = ${itemId}
      `),
    );
    expect(stored.rows).toEqual([{ attempts: 2, interval_stage: 2 }]);
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
