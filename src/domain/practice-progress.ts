const dayMilliseconds = 86_400_000;

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
