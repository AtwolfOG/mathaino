import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { LearningReader } from "../../application/learning-reader.ts";
import type { TransactionHost } from "./client.ts";
import type { Clock } from "./learning-queue.ts";
import {
  bibleBooks,
  bibleVerses,
  learningItems,
  learningPreferences,
  reviewSchedules,
} from "./schema.ts";
import { withUserDatabase } from "./with-user.ts";

export function createLearningReader(
  database: TransactionHost,
  clock: Clock = { now: () => new Date() },
): LearningReader {
  const fields = {
    id: learningItems.id,
    translationId: bibleVerses.translationId,
    bookId: bibleVerses.bookId,
    bookName: bibleBooks.name,
    chapter: bibleVerses.chapter,
    verse: bibleVerses.verse,
    text: bibleVerses.text,
    state: learningItems.state,
    archivedAt: learningItems.archivedAt,
    masteryThresholdOverride: learningItems.masteryThresholdOverride,
    defaultMasteryThreshold: learningPreferences.masteryThreshold,
    nextDueAt: reviewSchedules.nextDueAt,
  };
  return {
    list: async (authentication) => {
      const userId = await authentication.getUserId();
      if (!userId) throw new Error("Authentication required.");
      return withUserDatabase(database, authentication, async (tx) => {
        const rows = await tx
          .select(fields)
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
          .leftJoin(
            learningPreferences,
            eq(learningPreferences.userId, learningItems.userId),
          )
          .where(eq(learningItems.userId, userId))
          .orderBy(asc(learningItems.queueOrder), asc(learningItems.id));
        return rows.map((row) => toView(row, clock.now()));
      });
    },
    find: async (authentication, id) => {
      const userId = await authentication.getUserId();
      if (!userId) throw new Error("Authentication required.");
      const rows = await withUserDatabase(database, authentication, (tx) =>
        tx
          .select(fields)
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
          .leftJoin(
            learningPreferences,
            eq(learningPreferences.userId, learningItems.userId),
          )
          .where(
            and(eq(learningItems.userId, userId), eq(learningItems.id, id)),
          )
          .limit(1),
      );
      return rows[0] ? toView(rows[0], clock.now()) : null;
    },
  };
}

function toView<
  T extends {
    state: "learning" | "mastered";
    archivedAt: Date | null;
    masteryThresholdOverride: number | null;
    defaultMasteryThreshold: number | null;
    nextDueAt: Date | null;
  },
>(row: T, now: Date) {
  const {
    archivedAt,
    masteryThresholdOverride,
    defaultMasteryThreshold,
    nextDueAt,
    ...item
  } = row;
  const accountMasteryThreshold = defaultMasteryThreshold ?? 3;
  return {
    ...item,
    archived: archivedAt !== null,
    masteryThreshold: masteryThresholdOverride ?? accountMasteryThreshold,
    defaultMasteryThreshold: accountMasteryThreshold,
    usesDefaultMasteryThreshold: masteryThresholdOverride === null,
    status:
      item.state === "learning"
        ? ("learning" as const)
        : nextDueAt && nextDueAt <= now
          ? ("review-due" as const)
          : ("mastered" as const),
  };
}
