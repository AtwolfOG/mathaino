import { expect, test } from "vitest";
import { determineMasteryTransition } from "@/domain/mastery";

test("one successful local-calendar day earns one mastery day", () => {
  expect(
    determineMasteryTransition({
      state: "learning",
      requiredConsecutiveDays: 3,
      successfulDates: [],
      attemptedDate: "2026-01-02",
      successful: true,
    }),
  ).toEqual({
    creditSuccessfulDay: true,
    consecutiveDays: 1,
    transitionToMastered: false,
  });
});

test("successes on adjacent local-calendar days extend the chain", () => {
  expect(
    determineMasteryTransition({
      state: "learning",
      requiredConsecutiveDays: 3,
      successfulDates: ["2026-01-01", "2026-01-02"],
      attemptedDate: "2026-01-03",
      successful: true,
    }),
  ).toEqual({
    creditSuccessfulDay: true,
    consecutiveDays: 3,
    transitionToMastered: true,
  });
});

test("repeated successes on the same day do not add mastery credit", () => {
  expect(
    determineMasteryTransition({
      state: "learning",
      requiredConsecutiveDays: 3,
      successfulDates: ["2026-01-01", "2026-01-02"],
      attemptedDate: "2026-01-02",
      successful: true,
    }),
  ).toEqual({
    creditSuccessfulDay: false,
    consecutiveDays: 2,
    transitionToMastered: false,
  });
});

test("a success after a missed calendar day starts a new chain", () => {
  expect(
    determineMasteryTransition({
      state: "learning",
      requiredConsecutiveDays: 3,
      successfulDates: ["2026-01-01", "2026-01-02"],
      attemptedDate: "2026-01-04",
      successful: true,
    }),
  ).toEqual({
    creditSuccessfulDay: true,
    consecutiveDays: 1,
    transitionToMastered: false,
  });
});

test("a failed attempt preserves the current successful-day chain", () => {
  expect(
    determineMasteryTransition({
      state: "learning",
      requiredConsecutiveDays: 3,
      successfulDates: ["2026-01-01", "2026-01-02"],
      attemptedDate: "2026-01-03",
      successful: false,
    }),
  ).toEqual({
    creditSuccessfulDay: false,
    consecutiveDays: 2,
    transitionToMastered: false,
  });
});

test("a success on an earlier date after a timezone change cannot backfill progress", () => {
  expect(
    determineMasteryTransition({
      state: "learning",
      requiredConsecutiveDays: 3,
      successfulDates: ["2026-01-02", "2026-01-03"],
      attemptedDate: "2026-01-01",
      successful: true,
    }),
  ).toEqual({
    creditSuccessfulDay: false,
    consecutiveDays: 2,
    transitionToMastered: false,
  });
});

test("an already-mastered item cannot transition or earn learning credit again", () => {
  expect(
    determineMasteryTransition({
      state: "mastered",
      requiredConsecutiveDays: 1,
      successfulDates: ["2026-01-01"],
      attemptedDate: "2026-01-02",
      successful: true,
    }),
  ).toEqual({
    creditSuccessfulDay: false,
    consecutiveDays: 1,
    transitionToMastered: false,
  });
});

test("rejects invalid required consecutive-day values", () => {
  expect(() =>
    determineMasteryTransition({
      state: "learning",
      requiredConsecutiveDays: 0,
      successfulDates: [],
      attemptedDate: "2026-01-01",
      successful: true,
    }),
  ).toThrow("Required consecutive days must be an integer from 1 to 30.");
});
