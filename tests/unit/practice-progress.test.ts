import { expect, test } from "vitest";
import {
  countConsecutiveCalendarDays,
  summarizePracticeStreak,
} from "@/domain/practice-progress";

test("the first completed practice day starts both streaks", () => {
  expect(summarizePracticeStreak(["2026-01-02"], "2026-01-02")).toEqual({
    currentStreak: 1,
    longestStreak: 1,
    completedToday: true,
  });
});

test("consecutive completed days extend the current and longest streaks", () => {
  expect(
    summarizePracticeStreak(
      ["2026-01-01", "2026-01-02", "2026-01-03"],
      "2026-01-03",
    ),
  ).toEqual({ currentStreak: 3, longestStreak: 3, completedToday: true });
});

test("repeated and unsorted completion dates count once", () => {
  expect(
    summarizePracticeStreak(
      ["2026-01-02", "2026-01-01", "2026-01-02"],
      "2026-01-02",
    ),
  ).toEqual({ currentStreak: 2, longestStreak: 2, completedToday: true });
});

test("a streak ending yesterday remains current through today", () => {
  expect(
    summarizePracticeStreak(["2026-01-01", "2026-01-02"], "2026-01-03"),
  ).toEqual({ currentStreak: 2, longestStreak: 2, completedToday: false });
});

test("a fully missed local day resets only the current streak", () => {
  expect(
    summarizePracticeStreak(["2026-01-01", "2026-01-02"], "2026-01-04"),
  ).toEqual({ currentStreak: 0, longestStreak: 2, completedToday: false });
});

test("historical recalculation preserves an earlier longest streak", () => {
  expect(
    summarizePracticeStreak(
      ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-06", "2026-01-07"],
      "2026-01-07",
    ),
  ).toEqual({ currentStreak: 2, longestStreak: 3, completedToday: true });
});

test("preserved dates ahead of the current zone do not hide today's run", () => {
  expect(
    summarizePracticeStreak(
      ["2026-01-01", "2026-01-03", "2026-01-02"],
      "2026-01-02",
    ),
  ).toEqual({ currentStreak: 2, longestStreak: 3, completedToday: true });
});

test("an empty history has no streak", () => {
  expect(summarizePracticeStreak([], "2026-01-02")).toEqual({
    currentStreak: 0,
    longestStreak: 0,
    completedToday: false,
  });
});

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
  expect(() => summarizePracticeStreak([], "2026-02-30")).toThrow(
    "Invalid calendar date.",
  );
});
