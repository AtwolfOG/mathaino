import type { AuthenticationContext } from "./authentication-context.ts";
import type { BibleVerseReference } from "./bible-reader.ts";

export interface AddLearningResult {
  added: number;
  existing: number;
  restored: number;
}

export type RemovalPolicy = "archive" | "delete";

export interface LearningWriter {
  add(
    authentication: AuthenticationContext,
    references: readonly BibleVerseReference[],
  ): Promise<AddLearningResult>;
  remove(
    authentication: AuthenticationContext,
    id: string,
    policy?: RemovalPolicy,
  ): Promise<RemovalPolicy | null>;
  restore(authentication: AuthenticationContext, id: string): Promise<boolean>;
  getRemovalPolicy(
    authentication: AuthenticationContext,
  ): Promise<RemovalPolicy>;
  setRemovalPolicy(
    authentication: AuthenticationContext,
    policy: RemovalPolicy,
  ): Promise<void>;
}
