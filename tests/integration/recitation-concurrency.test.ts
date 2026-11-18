import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  createRecitationService,
  RecitationIneligibleError,
} from "@/application/recitation";
import { createDatabase } from "@/infrastructure/database/client";
import { applyMigrations } from "@/infrastructure/database/migrate";
import { createRecitationAttemptStore } from "@/infrastructure/database/recitation";
import { withUserDatabase } from "@/infrastructure/database/with-user";
import { getTestDatabaseUrl } from "../helpers/database-url";

test("concurrent successes persist both attempts but award one successful day", async () => {
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
  const bookId = `mastery${suffix}`;
  const authentication = { getUserId: async () => userId };
  let now = new Date("2026-01-02T12:00:00Z");
  try {
    await applyMigrations(first.db);
    await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        insert into users (id, display_name)
        values (${userId}, 'Concurrent learner')
      `),
    );
    await first.db.execute(sql`
      insert into bible_books (translation_id, id, name)
      values ('en-kjv', ${bookId}, 'Mastery Book')
    `);
    await first.db.execute(sql`
      insert into bible_chapters (translation_id, book_id, id)
      values ('en-kjv', ${bookId}, '1')
    `);
    await first.db.execute(sql`
      insert into bible_verses
        (id, translation_id, book_id, chapter, verse, text)
      values (${verseId}, 'en-kjv', ${bookId}, '1', '1', 'Concurrent verse')
    `);
    await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        insert into learning_items (id, user_id, verse_id)
        values (${itemId}, ${userId}, ${verseId})
      `),
    );
    const command = (operationId: string) => ({
      itemId,
      operationId,
      text: "Concurrent verse",
    });
    const firstService = createRecitationService(
      createRecitationAttemptStore(first.db, { now: () => now }),
    );
    const secondService = createRecitationService(
      createRecitationAttemptStore(second.db, { now: () => now }),
    );

    const results = await Promise.all([
      firstService.submit(authentication, command(randomUUID())),
      secondService.submit(authentication, command(randomUUID())),
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        status: "recorded",
        progress: expect.objectContaining({ consecutiveDays: 1 }),
      }),
      expect.objectContaining({
        status: "recorded",
        progress: expect.objectContaining({ consecutiveDays: 1 }),
      }),
    ]);
    const replayOperationId = randomUUID();
    const replays = await Promise.all([
      firstService.submit(authentication, command(replayOperationId)),
      secondService.submit(authentication, command(replayOperationId)),
    ]);
    expect(replays.map(({ status }) => status).sort()).toEqual([
      "duplicate",
      "recorded",
    ]);
    await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        update learning_items
        set mastery_threshold_override = 2
        where id = ${itemId}
      `),
    );
    now = new Date("2026-01-03T12:00:00Z");
    const masteryResults = await Promise.allSettled([
      firstService.submit(authentication, command(randomUUID())),
      secondService.submit(authentication, command(randomUUID())),
    ]);
    expect(masteryResults.map(({ status }) => status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const mastered = masteryResults.find(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof firstService.submit>>
      > => result.status === "fulfilled",
    );
    const rejected = masteryResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(mastered?.value.progress.mastered).toBe(true);
    expect(rejected?.reason).toBeInstanceOf(RecitationIneligibleError);
    const stored = await withUserDatabase(first.db, authentication, (tx) =>
      tx.execute(sql`
        select
          (select count(*)::int from practice_attempts) as attempts,
          (select count(*)::int from learning_success_days) as success_days,
          (select count(*)::int from review_schedules) as schedules
      `),
    );
    expect(stored.rows).toEqual([
      { attempts: 4, success_days: 2, schedules: 1 },
    ]);
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
