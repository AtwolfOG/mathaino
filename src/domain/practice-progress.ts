const dayMilliseconds = 86_400_000;

export interface PracticeStreakSummary {
  currentStreak: number;
  longestStreak: number;
  completedToday: boolean;
}

export function summarizePracticeStreak(
  dates: readonly string[],
  currentDate: string,
): PracticeStreakSummary {
  const today = parseCalendarDate(currentDate);
  const days = [...new Set(dates.map(parseCalendarDate))].sort(
    (left, right) => left - right,
  );
  if (days.length === 0)
    return { currentStreak: 0, longestStreak: 0, completedToday: false };

  let run = 1;
  let longestStreak = 1;
  let currentRun = days[0]! <= today ? 1 : 0;
  let currentRunEnd = days[0]! <= today ? days[0]! : null;
  for (let index = 1; index < days.length; index += 1) {
    run = days[index]! - days[index - 1]! === dayMilliseconds ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    if (days[index]! <= today) {
      currentRun = run;
      currentRunEnd = days[index]!;
    }
  }

  const daysSinceCurrentRun =
    currentRunEnd === null
      ? Number.POSITIVE_INFINITY
      : (today - currentRunEnd) / dayMilliseconds;
  return {
    currentStreak:
      daysSinceCurrentRun === 0 || daysSinceCurrentRun === 1 ? currentRun : 0,
    longestStreak,
    completedToday: days.includes(today),
  };
}

export function countConsecutiveCalendarDays(dates: readonly string[]): number {
  const days = [...new Set(dates.map(parseCalendarDate))].sort(
    (left, right) => left - right,
  );
  if (days.length === 0) return 0;

  let count = 1;
  for (let index = days.length - 1; index > 0; index -= 1) {
    if (days[index]! - days[index - 1]! !== dayMilliseconds) break;
    count += 1;
  }
  return count;
}

function parseCalendarDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid calendar date.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  )
    throw new Error("Invalid calendar date.");
  return timestamp;
}
