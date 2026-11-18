export interface MasteryTransitionInput {
  state: "learning" | "mastered";
  requiredConsecutiveDays: number;
  successfulDates: readonly string[];
  attemptedDate: string;
  successful: boolean;
}

export interface MasteryTransition {
  creditSuccessfulDay: boolean;
  consecutiveDays: number;
  transitionToMastered: boolean;
}

export function determineMasteryTransition(
  input: MasteryTransitionInput,
): MasteryTransition {
  if (
    !Number.isInteger(input.requiredConsecutiveDays) ||
    input.requiredConsecutiveDays < 1 ||
    input.requiredConsecutiveDays > 30
  )
    throw new Error(
      "Required consecutive days must be an integer from 1 to 30.",
    );
  const progress = summarizeSuccessfulDates(input.successfulDates);
  if (input.state === "learning" && input.successful) {
    const attemptedDay = parseCalendarDate(input.attemptedDate);
    if (progress.latestDay !== null && attemptedDay <= progress.latestDay) {
      return {
        creditSuccessfulDay: false,
        consecutiveDays: progress.consecutiveDays,
        transitionToMastered: false,
      };
    }
    const adjacent =
      progress.latestDay !== null &&
      attemptedDay - progress.latestDay === dayMilliseconds;
    const consecutiveDays = adjacent ? progress.consecutiveDays + 1 : 1;
    return {
      creditSuccessfulDay: true,
      consecutiveDays,
      transitionToMastered: consecutiveDays >= input.requiredConsecutiveDays,
    };
  }
  return {
    creditSuccessfulDay: false,
    consecutiveDays: progress.consecutiveDays,
    transitionToMastered: false,
  };
}

export function countConsecutiveSuccessfulDays(
  successfulDates: readonly string[],
): number {
  return summarizeSuccessfulDates(successfulDates).consecutiveDays;
}

const dayMilliseconds = 86_400_000;

function summarizeSuccessfulDates(dates: readonly string[]) {
  let latestDay: number | null = null;
  let consecutiveDays = 0;
  for (const date of dates) {
    const day = parseCalendarDate(date);
    if (latestDay !== null && day <= latestDay) continue;
    consecutiveDays =
      latestDay !== null && day - latestDay === dayMilliseconds
        ? consecutiveDays + 1
        : 1;
    latestDay = day;
  }
  return { latestDay, consecutiveDays };
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
