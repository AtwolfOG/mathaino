import { expect, test } from "vitest";
import { countConsecutiveCalendarDays } from "@/domain/practice-progress";

test("counts one sealed credit per consecutive calendar day", () => {
  expect(
    countConsecutiveCalendarDays([
      "2026-03-08",
      "2026-03-09",
      "2026-03-09",
      "2026-03-10",
    ]),
  ).toBe(3);
});

test("a calendar gap starts a new run", () => {
  expect(
    countConsecutiveCalendarDays([
      "2026-01-01",
      "2026-01-02",
      "2026-01-04",
      "2026-01-05",
    ]),
  ).toBe(2);
});

test("calendar arithmetic handles leap days without elapsed-time assumptions", () => {
  expect(
    countConsecutiveCalendarDays(["2028-02-28", "2028-02-29", "2028-03-01"]),
  ).toBe(3);
});

test("rejects malformed stored calendar dates", () => {
  expect(() => countConsecutiveCalendarDays(["2026-02-30"])).toThrow(
    "Invalid calendar date.",
  );
});
