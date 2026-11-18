import type { PracticeStreakSummary } from "../domain/practice-progress.ts";
import type { AuthenticationContext } from "./authentication-context.ts";

export interface PracticeProgressReader {
  read(authentication: AuthenticationContext): Promise<PracticeStreakSummary>;
}
