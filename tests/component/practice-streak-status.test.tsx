import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { PracticeStreakStatus } from "@/ui/learning/practice-streak-status";

test("shows current and longest streaks when practice is complete today", () => {
  render(
    <PracticeStreakStatus currentStreak={4} longestStreak={9} completedToday />,
  );

  expect(
    screen.getByRole("heading", { name: "Practice streak" }),
  ).toBeVisible();
  expect(screen.getByText("4", { selector: "dd" })).toBeVisible();
  expect(screen.getByText("9", { selector: "dd" })).toBeVisible();
  expect(screen.getByText("Practice complete today.")).toBeVisible();
});

test("prompts for today's practice while yesterday's streak remains active", () => {
  render(
    <PracticeStreakStatus
      currentStreak={4}
      longestStreak={9}
      completedToday={false}
    />,
  );

  expect(screen.getByText("Practice today to keep it going.")).toBeVisible();
});

test("explains how to begin when there is no current streak", () => {
  render(
    <PracticeStreakStatus
      currentStreak={0}
      longestStreak={3}
      completedToday={false}
    />,
  );

  expect(
    screen.getByText("Complete an assessed practice to start a new streak."),
  ).toBeVisible();
});
