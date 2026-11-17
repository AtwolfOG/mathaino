import type { AuthenticationContext } from "./authentication-context.ts";
import {
  evaluateRecitation,
  normalizeRecitationText,
  type RecitationEvaluation,
} from "../domain/recitation-evaluation.ts";

export interface RecitationCommand {
  itemId: string;
  operationId: string;
  text: string;
  mode?: "typing" | "voice";
}

export interface RecitationProgress {
  consecutiveDays: number;
  masteryThreshold: number;
  mastered: boolean;
  practiceStreak: number;
}

export interface RecitationResult {
  status: "recorded" | "duplicate";
  evaluation: RecitationEvaluation;
  progress: RecitationProgress;
}

export interface RecitationAttemptStore {
  submit(
    authentication: AuthenticationContext,
    command: RecitationCommand,
    assess: (expected: string) => RecitationEvaluation,
  ): Promise<RecitationResult>;
}

export interface RecitationService {
  submit(
    authentication: AuthenticationContext,
    command: RecitationCommand,
  ): Promise<RecitationResult>;
}

export class RecitationValidationError extends Error {}
export class RecitationNotFoundError extends Error {}
export class RecitationConflictError extends Error {}
export class RecitationIneligibleError extends Error {}

export function createRecitationService(
  store: RecitationAttemptStore,
): RecitationService {
  return {
    submit: async (authentication, command) => {
      if (!uuid.test(command.itemId) || !uuid.test(command.operationId))
        throw new RecitationValidationError("Invalid recitation identifiers.");
      if ([...command.text].length > 10_000)
        throw new RecitationValidationError(
          "Recitation must be 10,000 characters or fewer.",
        );
      const normalized = normalizeRecitationText(command.text);
      if (normalized.length === 0)
        throw new RecitationValidationError(
          "Type a recitation before submitting.",
        );
      if (normalized.split(" ").length > 1_000)
        throw new RecitationValidationError(
          "Recitation must be 1,000 words or fewer.",
        );
      return store.submit(authentication, command, (expected) =>
        evaluateRecitation(expected, command.text, { passingAccuracy: 90 }),
      );
    },
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
