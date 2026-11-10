import "server-only";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { LearningWriter } from "../../application/learning-writer.ts";
import type { TransactionHost } from "./client.ts";
import { bibleVerses, learningItems, learningPreferences } from "./schema.ts";
import { withUserDatabase } from "./with-user.ts";

const bookIdentifier = /^[a-z0-9]+$/;
const numberIdentifier = /^[1-9][0-9]*$/;

export function createLearningWriter(
  database: TransactionHost,
): LearningWriter {
  return {
    add: async (authentication, references) => {
      const userId = await authentication.getUserId();
      if (!userId) throw new Error("Authentication required.");
      const unique = new Map(
        references.map((reference) => [
          `${reference.bookId}/${reference.chapterId}/${reference.verseNumber}`,
          reference,
        ]),
      );
      const selected = [...unique.values()];
      if (!selected.length) throw new Error("Select at least one verse.");
      if (
        selected.some(
          ({ bookId, chapterId, verseNumber }) =>
            !bookIdentifier.test(bookId) ||
            !numberIdentifier.test(chapterId) ||
            !numberIdentifier.test(verseNumber),
        )
      )
        throw new Error("Invalid Bible reference.");

      return withUserDatabase(
        database,
        { getUserId: async () => userId },
        async (transaction) => {
          const verses = await transaction
            .select({
              id: bibleVerses.id,
              bookId: bibleVerses.bookId,
              chapter: bibleVerses.chapter,
              verse: bibleVerses.verse,
            })
            .from(bibleVerses)
            .where(
              and(
                eq(bibleVerses.translationId, "en-kjv"),
                or(
                  ...selected.map((reference) =>
                    and(
                      eq(bibleVerses.bookId, reference.bookId),
                      eq(bibleVerses.chapter, reference.chapterId),
                      eq(bibleVerses.verse, reference.verseNumber),
                    ),
                  ),
                ),
              ),
            );
          if (verses.length !== selected.length)
            throw new Error("Bible verse not found.");
          const verseByReference = new Map(
            verses.map((verse) => [
              `${verse.bookId}/${verse.chapter}/${verse.verse}`,
              verse.id,
            ]),
          );
          const verseIds = selected.map((reference) => {
            const id = verseByReference.get(
              `${reference.bookId}/${reference.chapterId}/${reference.verseNumber}`,
            );
            if (!id) throw new Error("Bible verse not found.");
            return id;
          });
          const restored = await transaction
            .update(learningItems)
            .set({ archivedAt: null, updatedAt: new Date() })
            .where(
              and(
                eq(learningItems.userId, userId),
                inArray(learningItems.verseId, verseIds),
                isNotNull(learningItems.archivedAt),
              ),
            )
            .returning({ id: learningItems.id });
          const inserted = await transaction
            .insert(learningItems)
            .values(verseIds.map((verseId) => ({ userId, verseId })))
            .onConflictDoNothing({
              target: [learningItems.userId, learningItems.verseId],
            })
            .returning({ id: learningItems.id });
          return {
            added: inserted.length,
            existing: selected.length - inserted.length - restored.length,
            restored: restored.length,
          };
        },
      );
    },
    remove: async (authentication, id, requestedPolicy) => {
      const userId = await requireUser(authentication);
      return withUserDatabase(database, authentication, async (transaction) => {
        const preferences = await transaction
          .select({ removalPolicy: learningPreferences.removalPolicy })
          .from(learningPreferences)
          .where(eq(learningPreferences.userId, userId))
          .limit(1);
        const policy =
          requestedPolicy ?? preferences[0]?.removalPolicy ?? "archive";
        await transaction
          .update(learningPreferences)
          .set({
            currentLearningItemId: null,
            queueVersion: sql`${learningPreferences.queueVersion} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(learningPreferences.userId, userId),
              eq(learningPreferences.currentLearningItemId, id),
            ),
          );
        const changed =
          policy === "archive"
            ? await transaction
                .update(learningItems)
                .set({ archivedAt: new Date(), updatedAt: new Date() })
                .where(
                  and(
                    eq(learningItems.userId, userId),
                    eq(learningItems.id, id),
                  ),
                )
                .returning({ id: learningItems.id })
            : await transaction
                .delete(learningItems)
                .where(
                  and(
                    eq(learningItems.userId, userId),
                    eq(learningItems.id, id),
                  ),
                )
                .returning({ id: learningItems.id });
        return changed.length ? policy : null;
      });
    },
    restore: async (authentication, id) => {
      const userId = await requireUser(authentication);
      return withUserDatabase(database, authentication, async (transaction) => {
        const restored = await transaction
          .update(learningItems)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(learningItems.userId, userId),
              eq(learningItems.id, id),
              isNotNull(learningItems.archivedAt),
            ),
          )
          .returning({ id: learningItems.id });
        return restored.length === 1;
      });
    },
    getRemovalPolicy: async (authentication) => {
      const userId = await requireUser(authentication);
      return withUserDatabase(database, authentication, async (transaction) => {
        const rows = await transaction
          .select({ removalPolicy: learningPreferences.removalPolicy })
          .from(learningPreferences)
          .where(eq(learningPreferences.userId, userId))
          .limit(1);
        return rows[0]?.removalPolicy ?? "archive";
      });
    },
    setRemovalPolicy: async (authentication, removalPolicy) => {
      const userId = await requireUser(authentication);
      await withUserDatabase(database, authentication, async (transaction) => {
        await transaction
          .insert(learningPreferences)
          .values({ userId, removalPolicy })
          .onConflictDoUpdate({
            target: learningPreferences.userId,
            set: { removalPolicy, updatedAt: new Date() },
          });
      });
    },
  };
}

async function requireUser(authentication: {
  getUserId(): Promise<string | null>;
}) {
  const userId = await authentication.getUserId();
  if (!userId) throw new Error("Authentication required.");
  return userId;
}
