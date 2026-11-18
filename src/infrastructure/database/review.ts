import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  ReviewConflictError,
  ReviewIneligibleError,
  ReviewNotFoundError,
  type ReviewAttemptStore,
  type ReviewResult,
} from "../../application/review.ts";
import { isValidIanaTimeZone } from "../../application/practice-settings.ts";
import { localCalendarDate } from "../../domain/calendar-day.ts";
import {
  advanceReviewSchedule,
  reviewIntervals,
  reviewPolicyId,
} from "../../domain/review-schedule.ts";
import type { DatabaseTransaction, TransactionHost } from "./client.ts";
import {
  bibleVerses,
  dailyPracticeCompletions,
  learningItems,
  learningPreferences,
  practiceAttempts,
  reviewSchedules,
} from "./schema.ts";
import { withUserDatabase } from "./with-user.ts";

export interface ReviewClock {
  now(): Date;
}

export function createReviewAttemptStore(
  database: TransactionHost,
  clock: ReviewClock = { now: () => new Date() },
): ReviewAttemptStore {
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
            purpose: "review",
            itemId: command.itemId,
            mode: "typing",
            assessmentPolicy,
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
              throw new ReviewConflictError(
                "Operation identifier was already used for another request.",
              );
            const schedule = await loadSchedule(
              transaction,
              userId,
              existing.itemId,
            );
            return result("duplicate", assess(existing.expectedText), schedule);
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
          if (!target) throw new ReviewNotFoundError("Review item not found.");
          if (target.archivedAt || target.state !== "mastered")
            throw new ReviewIneligibleError(
              "Only active mastered items accept reviews.",
            );

          const schedules = await transaction
            .select({
              stage: reviewSchedules.intervalStage,
              nextDueAt: reviewSchedules.nextDueAt,
              policyId: reviewSchedules.policyId,
            })
            .from(reviewSchedules)
            .where(
              and(
                eq(reviewSchedules.userId, userId),
                eq(reviewSchedules.learningItemId, target.id),
              ),
            )
            .limit(1)
            .for("update");
          const schedule = schedules[0];
          if (!schedule)
            throw new ReviewIneligibleError("Review schedule not found.");
          if (schedule.policyId !== reviewPolicyId)
            throw new Error("Unsupported stored review policy.");
          if (schedule.nextDueAt.getTime() > now.getTime())
            throw new ReviewIneligibleError("Review is not due yet.");

          await transaction
            .insert(learningPreferences)
            .values({ userId })
            .onConflictDoNothing({ target: learningPreferences.userId });
          const settings = await transaction
            .select({ timeZone: learningPreferences.timeZone })
            .from(learningPreferences)
            .where(eq(learningPreferences.userId, userId))
            .limit(1)
            .for("update");
          const preference = settings[0];
          if (!preference || !isValidIanaTimeZone(preference.timeZone))
            throw new Error("Invalid stored practice settings.");

          const evaluation = assess(target.expectedText);
          const practiceDate = localCalendarDate(now, preference.timeZone);
          const inserted = await transaction
            .insert(practiceAttempts)
            .values({
              userId,
              learningItemId: target.id,
              operationId: command.operationId,
              requestHash,
              mode: "typing",
              purpose: "review",
              outcome: evaluation.passed ? "success" : "failure",
              practicedAt: now,
              practiceDate,
              timeZone: preference.timeZone,
              assessmentPolicy,
              dayPolicy,
            })
            .returning({ id: practiceAttempts.id });
          const attempt = inserted[0];
          if (!attempt) throw new Error("Review attempt was not recorded.");

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

          const transition = advanceReviewSchedule(
            schedule.stage,
            evaluation.passed,
          );
          const updated = await transaction
            .update(reviewSchedules)
            .set({
              intervalStage: transition.stage,
              nextDueAt: sql`((${now}::timestamptz at time zone ${preference.timeZone}) + (${transition.intervalDays} * interval '1 day')) at time zone ${preference.timeZone}`,
              lastReviewedAt: now,
              policyId: reviewPolicyId,
              updatedAt: now,
            })
            .where(
              and(
                eq(reviewSchedules.userId, userId),
                eq(reviewSchedules.learningItemId, target.id),
              ),
            )
            .returning({ nextDueAt: reviewSchedules.nextDueAt });
          const next = updated[0];
          if (!next) throw new Error("Review schedule was not updated.");

          return {
            status: "recorded" as const,
            evaluation,
            schedule: {
              ...transition,
              nextDueAt: next.nextDueAt.toISOString(),
            },
          };
        },
      );
    },
  };
}

const assessmentPolicy = "word-levenshtein-90-v1";
const dayPolicy = "server-accepted-account-zone-v1";

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

async function loadSchedule(
  transaction: DatabaseTransaction,
  userId: string,
  itemId: string,
) {
  const rows = await transaction
    .select({
      stage: reviewSchedules.intervalStage,
      nextDueAt: reviewSchedules.nextDueAt,
    })
    .from(reviewSchedules)
    .where(
      and(
        eq(reviewSchedules.userId, userId),
        eq(reviewSchedules.learningItemId, itemId),
      ),
    )
    .limit(1);
  const schedule = rows[0];
  if (!schedule) throw new Error("Review schedule could not be loaded.");
  return schedule;
}

function result(
  status: "duplicate",
  evaluation: ReviewResult["evaluation"],
  schedule: { stage: number; nextDueAt: Date },
): ReviewResult {
  const intervalDays = reviewIntervals[schedule.stage];
  if (!intervalDays) throw new Error("Invalid stored review stage.");
  return {
    status,
    evaluation,
    schedule: {
      stage: schedule.stage,
      intervalDays,
      nextDueAt: schedule.nextDueAt.toISOString(),
    },
  };
}
