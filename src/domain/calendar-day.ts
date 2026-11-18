export function localCalendarDate(instant: Date, timeZone: string): string {
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid instant.");
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
    throw new Error("Local calendar date could not be derived.");
  return `${year}-${month}-${day}`;
}
