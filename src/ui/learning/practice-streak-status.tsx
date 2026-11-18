import type { PracticeStreakSummary } from "../../domain/practice-progress.ts";

export function PracticeStreakStatus({
  currentStreak,
  longestStreak,
  completedToday,
}: PracticeStreakSummary) {
  const message = completedToday
    ? "Practice complete today."
    : currentStreak > 0
      ? "Practice today to keep it going."
      : "Complete an assessed practice to start a new streak.";
  return (
    <section
      className="practice-streak"
      aria-labelledby="practice-streak-title"
    >
      <div>
        <h2 id="practice-streak-title">Practice streak</h2>
        <p>{message}</p>
      </div>
      <dl>
        <div>
          <dt>Current</dt>
          <dd>{currentStreak}</dd>
        </div>
        <div>
          <dt>Longest</dt>
          <dd>{longestStreak}</dd>
        </div>
      </dl>
    </section>
  );
}
