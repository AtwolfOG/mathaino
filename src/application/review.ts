import type { AuthenticationContext } from "./authentication-context.ts";
import {
  evaluateRecitation,
  normalizeRecitationText,
  type RecitationEvaluation,
} from "../domain/recitation-evaluation.ts";

export interface ReviewCommand {
  itemId: string;
  operationId: string;
  text: string;
}

export interface ReviewResult {
  status: "recorded" | "duplicate";
  evaluation: RecitationEvaluation;
  schedule: {
    stage: number;
    intervalDays: number;
    nextDueAt: string;
  };
}

export interface ReviewAttemptStore {
  submit(
    authentication: AuthenticationContext,
    command: ReviewCommand,
    assess: (expected: string) => RecitationEvaluation,
  ): Promise<ReviewResult>;
}

export interface ReviewService {
  submit(
    authentication: AuthenticationContext,
    command: ReviewCommand,
  ): Promise<ReviewResult>;
}

export class ReviewValidationError extends Error {}
export class ReviewNotFoundError extends Error {}
export class ReviewConflictError extends Error {}
export class ReviewIneligibleError extends Error {}

export function createReviewService(store: ReviewAttemptStore): ReviewService {
  return {
    submit: async (authentication, command) => {
      if (!uuid.test(command.itemId) || !uuid.test(command.operationId))
        throw new ReviewValidationError("Invalid review identifiers.");
      if ([...command.text].length > 10_000)
        throw new ReviewValidationError(
          "Review must be 10,000 characters or fewer.",
        );
      const normalized = normalizeRecitationText(command.text);
      if (normalized.length === 0)
        throw new ReviewValidationError("Type a review before submitting.");
      if (normalized.split(" ").length > 1_000)
        throw new ReviewValidationError("Review must be 1,000 words or fewer.");
      return store.submit(authentication, command, (expected) =>
        evaluateRecitation(expected, command.text, { passingAccuracy: 90 }),
      );
    },
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
