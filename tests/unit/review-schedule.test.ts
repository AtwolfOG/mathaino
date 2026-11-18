import { describe, expect, test } from "vitest";
import {
  advanceReviewSchedule,
  reviewPolicyId,
} from "@/domain/review-schedule";

describe("fixed review ladder", () => {
  test("successful reviews advance through deterministic intervals", () => {
    expect(reviewPolicyId).toBe("fixed-review-ladder-v1");
    expect(advanceReviewSchedule(0, true)).toEqual({
      stage: 1,
      intervalDays: 3,
    });
    expect(advanceReviewSchedule(3, true)).toEqual({
      stage: 4,
      intervalDays: 30,
    });
  });

  test("successful reviews remain capped at 120 days", () => {
    expect(advanceReviewSchedule(6, true)).toEqual({
      stage: 6,
      intervalDays: 120,
    });
  });

  test("failed reviews reset to the one-day interval", () => {
    expect(advanceReviewSchedule(5, false)).toEqual({
      stage: 0,
      intervalDays: 1,
    });
    expect(advanceReviewSchedule(0, false)).toEqual({
      stage: 0,
      intervalDays: 1,
    });
  });

  test.each([-1, 1.5, 7, Number.NaN])(
    "rejects invalid current stage %s",
    (stage) => {
      expect(() => advanceReviewSchedule(stage, true)).toThrow(
        "Invalid review stage.",
      );
    },
  );
});
