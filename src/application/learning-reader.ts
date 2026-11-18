import type { AuthenticationContext } from "./authentication-context.ts";

export interface LearningItemView {
  id: string;
  translationId: string;
  bookId: string;
  bookName: string;
  chapter: string;
  verse: string;
  text: string;
  state: "learning" | "mastered";
  status: "learning" | "mastered" | "review-due";
  archived: boolean;
  masteryThreshold: number;
  defaultMasteryThreshold: number;
  usesDefaultMasteryThreshold: boolean;
}
export interface LearningReader {
  list(authentication: AuthenticationContext): Promise<LearningItemView[]>;
  find(
    authentication: AuthenticationContext,
    id: string,
  ): Promise<LearningItemView | null>;
}
