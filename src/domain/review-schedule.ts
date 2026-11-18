export const reviewPolicyId = "fixed-review-ladder-v1";
export const reviewIntervals = [1, 3, 7, 14, 30, 60, 120] as const;

export interface ReviewScheduleTransition {
  stage: number;
  intervalDays: number;
}

export function advanceReviewSchedule(
  currentStage: number,
  successful: boolean,
): ReviewScheduleTransition {
  if (
    !Number.isInteger(currentStage) ||
    currentStage < 0 ||
    currentStage >= reviewIntervals.length
  )
    throw new Error("Invalid review stage.");

  const stage = successful
    ? Math.min(currentStage + 1, reviewIntervals.length - 1)
    : 0;
  const intervalDays = reviewIntervals[stage];
  if (!intervalDays) throw new Error("Invalid review stage.");
  return { stage, intervalDays };
}
