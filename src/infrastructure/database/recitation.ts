import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  RecitationConflictError,
  RecitationIneligibleError,
  RecitationNotFoundError,
  type RecitationAttemptStore,
  type RecitationProgress,
} from "../../application/recitation.ts";
import { isValidIanaTimeZone } from "../../application/practice-settings.ts";
import { countConsecutiveCalendarDays } from "../../domain/practice-progress.ts";
import type { DatabaseTransaction, TransactionHost } from "./client.ts";
import {
  bibleVerses,
  dailyPracticeCompletions,
  learningItems,
  learningPreferences,
  learningSuccessDays,
  practiceAttempts,
} from "./schema.ts";
import { withUserDatabase } from "./with-user.ts";

export interface RecitationClock {
  now(): Date;
}

export function createRecitationAttemptStore(
  database: TransactionHost,
  clock: RecitationClock = { now: () => new Date() },
): RecitationAttemptStore {
  return {
    submit: async (authentication, command, assess) => {
      const userId = await authentication.getUserId();
      if (!userId) throw new Error("Authentication required.");
      const now = clock.now();
      if (!Number.isFinite(now.getTime()))
        throw new Error("Invalid server time.");
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            version: 1,
            itemId: command.itemId,
            mode: "typing",
            assessmentPolicy: assessmentPolicy,
            text: command.text,
          }),
        )
        .digest("hex");

      return withUserDatabase(
        database,
        { getUserId: async () => userId },
        async (transaction) => {
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${command.operationId}`}, 0))`,
          );
          const existing = await findOperation(
            transaction,
            userId,
            command.operationId,
          );
          if (existing) {
            if (existing.requestHash !== requestHash)
              throw new RecitationConflictError(
                "Operation identifier was already used for another request.",
              );
            return {
              status: "duplicate" as const,
              evaluation: assess(existing.expectedText),
              progress: await loadProgress(
                transaction,
                userId,
                existing.itemId,
              ),
            };
          }

          const targets = await transaction
            .select({
              id: learningItems.id,
              state: learningItems.state,
              archivedAt: learningItems.archivedAt,
              expectedText: bibleVerses.text,
            })
            .from(learningItems)
            .innerJoin(bibleVerses, eq(learningItems.verseId, bibleVerses.id))
            .where(
              and(
                eq(learningItems.userId, userId),
                eq(learningItems.id, command.itemId),
              ),
            )
            .limit(1)
            .for("update");
          const target = targets[0];
          if (!target)
            throw new RecitationNotFoundError("Learning item not found.");
          if (target.archivedAt || target.state !== "learning")
            throw new RecitationIneligibleError(
              "Only active learning items accept typed recitations.",
            );

          await transaction
            .insert(learningPreferences)
            .values({ userId })
            .onConflictDoNothing({ target: learningPreferences.userId });
          const settings = await transaction
            .select({
              masteryThreshold: learningPreferences.masteryThreshold,
              timeZone: learningPreferences.timeZone,
            })
            .from(learningPreferences)
            .where(eq(learningPreferences.userId, userId))
            .limit(1);
          const preference = settings[0];
          if (!preference || !isValidIanaTimeZone(preference.timeZone))
            throw new Error("Invalid stored practice settings.");
          const practiceDate = localDate(now, preference.timeZone);
          const evaluation = assess(target.expectedText);
          const inserted = await transaction
            .insert(practiceAttempts)
            .values({
              userId,
              learningItemId: target.id,
              operationId: command.operationId,
              requestHash,
              mode: "typing",
              purpose: "learning",
              outcome: evaluation.passed ? "success" : "failure",
              practicedAt: now,
              practiceDate,
              timeZone: preference.timeZone,
              assessmentPolicy,
              dayPolicy,
            })
            .returning({ id: practiceAttempts.id });
          const attempt = inserted[0];
          if (!attempt) throw new Error("Attempt was not recorded.");

          await transaction
            .insert(dailyPracticeCompletions)
            .values({
              userId,
              practiceDate,
              sourceAttemptId: attempt.id,
              timeZone: preference.timeZone,
              dayPolicy,
            })
            .onConflictDoNothing({
              target: [
                dailyPracticeCompletions.userId,
                dailyPracticeCompletions.practiceDate,
              ],
            });

          if (evaluation.passed) {
            await transaction
              .insert(learningSuccessDays)
              .values({
                userId,
                learningItemId: target.id,
                practiceDate,
                sourceAttemptId: attempt.id,
                timeZone: preference.timeZone,
                dayPolicy,
              })
              .onConflictDoNothing({
                target: [
                  learningSuccessDays.userId,
                  learningSuccessDays.learningItemId,
                  learningSuccessDays.practiceDate,
                ],
              });
            const dates = await loadSuccessDates(
              transaction,
              userId,
              target.id,
            );
            if (
              countConsecutiveCalendarDays(dates) >= preference.masteryThreshold
            ) {
              await transaction
                .update(learningItems)
                .set({ state: "mastered", masteredAt: now, updatedAt: now })
                .where(
                  and(
                    eq(learningItems.userId, userId),
                    eq(learningItems.id, target.id),
                    eq(learningItems.state, "learning"),
                  ),
                );
              await transaction.execute(sql`
                insert into review_schedules
                  (learning_item_id, user_id, next_due_at, policy_id)
                values (
                  ${target.id},
                  ${userId},
                  ((${now}::timestamptz at time zone ${preference.timeZone}) + interval '1 day') at time zone ${preference.timeZone},
                  ${reviewPolicy}
                )
                on conflict (learning_item_id) do nothing
              `);
            }
          }

          return {
            status: "recorded" as const,
            evaluation,
            progress: await loadProgress(transaction, userId, target.id),
          };
        },
      );
    },
  };
}

const assessmentPolicy = "word-levenshtein-90-v1";
const dayPolicy = "server-accepted-account-zone-v1";
const reviewPolicy = "first-review-next-local-day-v1";

async function findOperation(
  transaction: DatabaseTransaction,
  userId: string,
  operationId: string,
) {
  const rows = await transaction
    .select({
      requestHash: practiceAttempts.requestHash,
      itemId: practiceAttempts.learningItemId,
      expectedText: bibleVerses.text,
    })
    .from(practiceAttempts)
    .innerJoin(
      learningItems,
      and(
        eq(learningItems.userId, practiceAttempts.userId),
        eq(learningItems.id, practiceAttempts.learningItemId),
      ),
    )
    .innerJoin(bibleVerses, eq(bibleVerses.id, learningItems.verseId))
    .where(
      and(
        eq(practiceAttempts.userId, userId),
        eq(practiceAttempts.operationId, operationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function loadSuccessDates(
  transaction: DatabaseTransaction,
  userId: string,
  itemId: string,
) {
  const rows = await transaction
    .select({ date: learningSuccessDays.practiceDate })
    .from(learningSuccessDays)
    .where(
      and(
        eq(learningSuccessDays.userId, userId),
        eq(learningSuccessDays.learningItemId, itemId),
      ),
    )
    .orderBy(asc(learningSuccessDays.practiceDate));
  return rows.map((row) => row.date);
}

async function loadProgress(
  transaction: DatabaseTransaction,
  userId: string,
  itemId: string,
): Promise<RecitationProgress> {
  const settings = await transaction
    .select({ masteryThreshold: learningPreferences.masteryThreshold })
    .from(learningPreferences)
    .where(eq(learningPreferences.userId, userId))
    .limit(1);
  const item = await transaction
    .select({ state: learningItems.state })
    .from(learningItems)
    .where(and(eq(learningItems.userId, userId), eq(learningItems.id, itemId)))
    .limit(1);
  const successDates = await loadSuccessDates(transaction, userId, itemId);
  const practiceDates = await transaction
    .select({ date: dailyPracticeCompletions.practiceDate })
    .from(dailyPracticeCompletions)
    .where(eq(dailyPracticeCompletions.userId, userId))
    .orderBy(asc(dailyPracticeCompletions.practiceDate));
  const preference = settings[0];
  const learningItem = item[0];
  if (!preference || !learningItem)
    throw new Error("Progress could not be loaded.");
  return {
    consecutiveDays: countConsecutiveCalendarDays(successDates),
    masteryThreshold: preference.masteryThreshold,
    mastered: learningItem.state === "mastered",
    practiceStreak: countConsecutiveCalendarDays(
      practiceDates.map((row) => row.date),
    ),
  };
}

function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day)
    throw new Error("Practice date could not be derived.");
  return `${year}-${month}-${day}`;
}
