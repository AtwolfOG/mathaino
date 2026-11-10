import type { AuthenticationContext } from "./authentication-context.ts";

export type LearningQueueStatus = "learning" | "review-due";

export interface LearningQueueItem {
  id: string;
  translationId: string;
  bookId: string;
  bookName: string;
  chapter: string;
  verse: string;
  text: string;
  status: LearningQueueStatus;
}

export interface LearningQueueView {
  current: LearningQueueItem | null;
  position: number;
  total: number;
  remaining: number;
  version: number;
  previousId: string | null;
  nextId: string | null;
}

export interface QueueSelectionResult {
  status: "updated" | "conflict" | "not-found";
  queue: LearningQueueView;
}

export interface LearningQueue {
  read(authentication: AuthenticationContext): Promise<LearningQueueView>;
  select(
    authentication: AuthenticationContext,
    itemId: string,
    expectedVersion: number,
  ): Promise<QueueSelectionResult>;
}
