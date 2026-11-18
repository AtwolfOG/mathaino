import "server-only";
import { asc, eq } from "drizzle-orm";
import type { PracticeProgressReader } from "../../application/practice-progress.ts";
import { isValidIanaTimeZone } from "../../application/practice-settings.ts";
import { localCalendarDate } from "../../domain/calendar-day.ts";
import { summarizePracticeStreak } from "../../domain/practice-progress.ts";
import type { TransactionHost } from "./client.ts";
import { dailyPracticeCompletions, learningPreferences } from "./schema.ts";
import { withUserDatabase } from "./with-user.ts";

export interface PracticeProgressClock {
  now(): Date;
}

export function createPracticeProgressReader(
  database: TransactionHost,
  clock: PracticeProgressClock = { now: () => new Date() },
): PracticeProgressReader {
  return {
    read: async (authentication) => {
      const userId = await authentication.getUserId();
      if (!userId) throw new Error("Authentication required.");
      const now = clock.now();
      if (!Number.isFinite(now.getTime()))
        throw new Error("Invalid server time.");
      return withUserDatabase(
        database,
        { getUserId: async () => userId },
        async (transaction) => {
          const settings = await transaction
            .select({ timeZone: learningPreferences.timeZone })
            .from(learningPreferences)
            .where(eq(learningPreferences.userId, userId))
            .limit(1);
          const timeZone = settings[0]?.timeZone ?? "Etc/UTC";
          if (!isValidIanaTimeZone(timeZone))
            throw new Error("Invalid stored practice settings.");
          const completions = await transaction
            .select({ date: dailyPracticeCompletions.practiceDate })
            .from(dailyPracticeCompletions)
            .where(eq(dailyPracticeCompletions.userId, userId))
            .orderBy(asc(dailyPracticeCompletions.practiceDate));
          return summarizePracticeStreak(
            completions.map((completion) => completion.date),
            localCalendarDate(now, timeZone),
          );
        },
      );
    },
  };
}
