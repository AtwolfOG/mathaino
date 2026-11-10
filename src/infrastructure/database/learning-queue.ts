import "server-only";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type {
  LearningQueue,
  LearningQueueItem,
  LearningQueueView,
} from "../../application/learning-queue.ts";
import type { DatabaseTransaction, TransactionHost } from "./client.ts";
import {
  bibleBooks,
  bibleVerses,
  learningItems,
  learningPreferences,
  reviewSchedules,
} from "./schema.ts";
import { withUserDatabase } from "./with-user.ts";

export interface Clock {
  now(): Date;
}

export function createLearningQueue(
  database: TransactionHost,
  clock: Clock = { now: () => new Date() },
): LearningQueue {
  return {
    read: async (authentication) => {
      const userId = await requireUser(authentication);
      return withUserDatabase(database, authentication, async (transaction) => {
        const loaded = await loadQueue(transaction, userId, clock.now());
        return loaded.view;
      });
    },
    select: async (authentication, itemId, expectedVersion) => {
      const userId = await requireUser(authentication);
      return withUserDatabase(database, authentication, async (transaction) => {
        const loaded = await loadQueue(transaction, userId, clock.now());
        const { items, view: queue } = loaded;
        if (!items.some((item) => item.id === itemId))
          return { status: "not-found", queue };

        await transaction
          .insert(learningPreferences)
          .values({ userId })
          .onConflictDoNothing({ target: learningPreferences.userId });
        const updated = await transaction
          .update(learningPreferences)
          .set({
            currentLearningItemId: itemId,
            queueVersion: sql`${learningPreferences.queueVersion} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(learningPreferences.userId, userId),
              eq(learningPreferences.queueVersion, expectedVersion),
            ),
          )
          .returning({ version: learningPreferences.queueVersion });
        if (!updated[0])
          return {
            status: "conflict",
            queue: (await loadQueue(transaction, userId, clock.now())).view,
          };
        return {
          status: "updated",
          queue: toView(items, itemId, updated[0].version),
        };
      });
    },
  };
}

async function loadQueue(
  transaction: DatabaseTransaction,
  userId: string,
  now: Date,
) {
  const rows = await transaction
    .select({
      id: learningItems.id,
      translationId: bibleVerses.translationId,
      bookId: bibleVerses.bookId,
      bookName: bibleBooks.name,
      chapter: bibleVerses.chapter,
      verse: bibleVerses.verse,
      text: bibleVerses.text,
      state: learningItems.state,
    })
    .from(learningItems)
    .innerJoin(bibleVerses, eq(learningItems.verseId, bibleVerses.id))
    .innerJoin(
      bibleBooks,
      and(
        eq(bibleBooks.translationId, bibleVerses.translationId),
        eq(bibleBooks.id, bibleVerses.bookId),
      ),
    )
    .leftJoin(
      reviewSchedules,
      and(
        eq(reviewSchedules.userId, learningItems.userId),
        eq(reviewSchedules.learningItemId, learningItems.id),
      ),
    )
    .where(
      and(
        eq(learningItems.userId, userId),
        isNull(learningItems.archivedAt),
        or(
          eq(learningItems.state, "learning"),
          and(
            eq(learningItems.state, "mastered"),
            lte(reviewSchedules.nextDueAt, now),
          ),
        ),
      ),
    )
    .orderBy(
      sql`case when ${learningItems.state} = 'learning' then 0 else 1 end`,
      asc(reviewSchedules.nextDueAt),
      asc(learningItems.queueOrder),
      asc(learningItems.id),
    );
  const items: LearningQueueItem[] = rows.map(({ state, ...row }) => ({
    ...row,
    status: state === "learning" ? "learning" : "review-due",
  }));
  const preferences = await transaction
    .select({
      currentId: learningPreferences.currentLearningItemId,
      version: learningPreferences.queueVersion,
    })
    .from(learningPreferences)
    .where(eq(learningPreferences.userId, userId))
    .limit(1);
  return {
    items,
    view: toView(
      items,
      preferences[0]?.currentId ?? null,
      preferences[0]?.version ?? 0,
    ),
  };
}

function toView(
  items: LearningQueueItem[],
  currentId: string | null,
  version: number,
): LearningQueueView {
  const selectedIndex = items.findIndex((item) => item.id === currentId);
  const index = selectedIndex >= 0 ? selectedIndex : 0;
  return {
    current: items[index] ?? null,
    position: items.length ? index + 1 : 0,
    total: items.length,
    remaining: items.length ? items.length - index - 1 : 0,
    version,
    previousId: items[index - 1]?.id ?? null,
    nextId: items[index + 1]?.id ?? null,
  };
}

async function requireUser(authentication: {
  getUserId(): Promise<string | null>;
}) {
  const userId = await authentication.getUserId();
  if (!userId) throw new Error("Authentication required.");
  return userId;
}
