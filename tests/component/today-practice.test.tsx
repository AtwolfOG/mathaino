import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { LearningQueueView } from "@/application/learning-queue";
import { TodayPractice } from "@/ui/learning/today-practice";

const firstId = "20000000-0000-4000-8000-000000000001";
const secondId = "20000000-0000-4000-8000-000000000002";
const queue: LearningQueueView = {
  current: {
    id: firstId,
    translationId: "en-kjv",
    bookId: "john",
    bookName: "John",
    chapter: "3",
    verse: "16",
    text: "For God so loved the world.",
    status: "learning",
  },
  position: 1,
  total: 2,
  remaining: 1,
  version: 0,
  previousId: null,
  nextId: secondId,
};

afterEach(() => vi.unstubAllGlobals());

test("Today presents one verse with status and queue progress", () => {
  render(<TodayPractice initialQueue={queue} />);
  expect(screen.getByRole("heading", { name: "John 3:16" })).toBeVisible();
  expect(screen.getByText("For God so loved the world.")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reveal verse" }));
  expect(screen.getByText("For God so loved the world.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Hide verse" }));
  expect(screen.getByText("For God so loved the world.")).not.toBeVisible();
  expect(screen.getByText("Learning")).toBeVisible();
  expect(screen.getByText("1 of 2")).toBeVisible();
  expect(screen.getByText("1 verse remaining")).toBeVisible();
  expect(screen.getByRole("button", { name: "Previous verse" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next verse" })).toBeEnabled();
});

test("keyboard submission displays accuracy, differences and pass feedback", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json(
      {
        status: "recorded",
        evaluation: {
          normalizedExpected: "for god so loved the world",
          normalizedSubmitted: "for god loved the world",
          differences: [
            {
              type: "omission",
              expected: "so",
              submitted: null,
              expectedIndex: 2,
              submittedIndex: 2,
            },
          ],
          accuracy: 83.33,
          passed: false,
          feedback: "Failed with 83.33% accuracy: 1 omitted word.",
        },
        progress: {
          consecutiveDays: 0,
          masteryThreshold: 3,
          mastered: false,
          practiceStreak: 1,
        },
      },
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(<TodayPractice initialQueue={queue} />);
  const input = screen.getByLabelText("Type John 3:16");
  fireEvent.change(input, { target: { value: "For God loved the world" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

  await waitFor(() =>
    expect(screen.getByText("83.33% accuracy")).toBeVisible(),
  );
  expect(
    screen.getByRole("heading", { name: "Keep practising" }),
  ).toBeVisible();
  expect(screen.getByText("Missing “so”")).toBeVisible();
  expect(screen.getByText("Practice streak: 1 day")).toBeVisible();
  expect(fetch).toHaveBeenCalledOnce();
  const options = fetch.mock.calls[0]?.[1] as RequestInit;
  expect(fetch.mock.calls[0]?.[0]).toBe("/api/recitation-attempts");
  expect(JSON.parse(String(options.body))).toMatchObject({
    itemId: firstId,
    text: "For God loved the world",
    operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
});

test("empty input is explained and duplicate pending submissions are prevented", async () => {
  let resolve: ((value: Response) => void) | undefined;
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  render(<TodayPractice initialQueue={queue} />);
  fireEvent.click(screen.getByRole("button", { name: "Check recitation" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Type your recitation before submitting.",
  );
  fireEvent.change(screen.getByLabelText("Type John 3:16"), {
    target: { value: "For God so loved the world" },
  });
  const submit = screen.getByRole("button", { name: "Check recitation" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(fetch).toHaveBeenCalledOnce();
  expect(submit).toBeDisabled();
  resolve?.(Response.json({ error: "failed" }, { status: 500 }));
});

test("an intentional retry clears feedback and focuses a fresh recitation", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json(
      {
        status: "recorded",
        evaluation: {
          normalizedExpected: "for god so loved the world",
          normalizedSubmitted: "wrong",
          differences: [],
          accuracy: 0,
          passed: false,
          feedback: "Failed.",
        },
        progress: {
          consecutiveDays: 0,
          masteryThreshold: 3,
          mastered: false,
          practiceStreak: 1,
        },
      },
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(<TodayPractice initialQueue={queue} />);
  const input = screen.getByLabelText("Type John 3:16");
  fireEvent.change(input, { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Check recitation" }));
  await screen.findByRole("button", { name: "Try again" });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(input).toHaveValue("");
  await waitFor(() => expect(input).toHaveFocus());
  expect(screen.queryByText("0% accuracy")).not.toBeInTheDocument();
});

test("due reviews explain why submission is unavailable", () => {
  render(
    <TodayPractice
      initialQueue={{
        ...queue,
        current: { ...queue.current!, status: "review-due" },
      }}
    />,
  );
  expect(screen.queryByLabelText("Type John 3:16")).not.toBeInTheDocument();
  expect(
    screen.getByText(/Typed review submission is not available yet/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reveal verse" }));
  expect(screen.getByText("For God so loved the world.")).toBeVisible();
});

test("queue navigation persists before showing the next verse", async () => {
  const next: LearningQueueView = {
    ...queue,
    current: {
      ...queue.current!,
      id: secondId,
      verse: "17",
      text: "The next verse.",
      status: "review-due",
    },
    position: 2,
    remaining: 0,
    version: 1,
    previousId: firstId,
    nextId: null,
  };
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ queue: next }, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  render(<TodayPractice initialQueue={queue} />);

  fireEvent.click(screen.getByRole("button", { name: "Next verse" }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "John 3:17" })).toBeVisible(),
  );
  expect(fetch).toHaveBeenCalledWith("/api/learning-queue", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: secondId, expectedVersion: 0 }),
  });
  expect(screen.getByText("Review due")).toBeVisible();
  expect(screen.getByText("No verses remaining")).toBeVisible();
});

test("an empty Today queue directs the learner to the Bible", () => {
  render(
    <TodayPractice
      initialQueue={{
        current: null,
        position: 0,
        total: 0,
        remaining: 0,
        version: 0,
        previousId: null,
        nextId: null,
      }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Nothing queued today" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Choose verses" })).toHaveAttribute(
    "href",
    "/bible",
  );
});
