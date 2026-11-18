import { expect, test, vi } from "vitest";
import type { LearningQueue } from "@/application/learning-queue";
import type { LearningWriter } from "@/application/learning-writer";
import {
  handleLearningPreferencesRequest,
  handleLearningQueueRequest,
} from "@/ui/http/learning-queue";

const userId = "00000000-0000-4000-8000-000000000001";
const itemId = "20000000-0000-4000-8000-000000000001";
const authentication = (id: string | null) => ({ getUserId: async () => id });
const empty = {
  current: null,
  position: 0,
  total: 0,
  remaining: 0,
  version: 0,
  previousId: null,
  nextId: null,
};

function queue(overrides: Partial<LearningQueue> = {}): LearningQueue {
  return {
    read: async () => empty,
    select: async () => ({ status: "not-found", queue: empty }),
    ...overrides,
  };
}

function writer(overrides: Partial<LearningWriter> = {}): LearningWriter {
  return {
    add: async () => ({ added: 0, existing: 0, restored: 0 }),
    remove: async () => null,
    restore: async () => false,
    setMasteryThresholdOverride: async () => false,
    getRemovalPolicy: async () => "archive",
    setRemovalPolicy: async () => undefined,
    ...overrides,
  };
}

test("queue reads and cursor updates return authoritative progress", async () => {
  const select = vi.fn<LearningQueue["select"]>().mockResolvedValue({
    status: "conflict",
    queue: { ...empty, version: 2 },
  });
  const context = authentication(userId);
  const read = await handleLearningQueueRequest(
    new Request("https://mathaino.test/api/learning-queue"),
    queue(),
    context,
  );
  expect(read.status).toBe(200);
  await expect(read.json()).resolves.toEqual({ queue: empty });

  const update = await handleLearningQueueRequest(
    new Request("https://mathaino.test/api/learning-queue", {
      method: "PATCH",
      headers: {
        origin: "https://mathaino.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ itemId, expectedVersion: 1 }),
    }),
    queue({ select }),
    context,
  );
  expect(update.status).toBe(409);
  await expect(update.json()).resolves.toEqual({
    queue: { ...empty, version: 2 },
  });
  expect(select).toHaveBeenCalledWith(context, itemId, 1);
});

test("queue requests reject anonymous, malformed, and cross-origin mutations", async () => {
  expect(
    (
      await handleLearningQueueRequest(
        new Request("https://mathaino.test/api/learning-queue"),
        queue(),
        authentication(null),
      )
    ).status,
  ).toBe(401);
  for (const [body, origin] of [
    [{ itemId: "bad", expectedVersion: 0 }, "https://mathaino.test"],
    [{ itemId, expectedVersion: -1 }, "https://mathaino.test"],
    [{ itemId, expectedVersion: 0 }, "https://evil.test"],
  ] as const) {
    const response = await handleLearningQueueRequest(
      new Request("https://mathaino.test/api/learning-queue", {
        method: "PATCH",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      queue(),
      authentication(userId),
    );
    expect(response.status).toBe(origin.includes("evil") ? 403 : 400);
  }
});

test("learning preferences expose and update the removal default", async () => {
  const setRemovalPolicy = vi.fn<LearningWriter["setRemovalPolicy"]>();
  const context = authentication(userId);
  const get = await handleLearningPreferencesRequest(
    new Request("https://mathaino.test/api/learning-preferences"),
    writer(),
    context,
  );
  await expect(get.json()).resolves.toEqual({ removalPolicy: "archive" });
  const patch = await handleLearningPreferencesRequest(
    new Request("https://mathaino.test/api/learning-preferences", {
      method: "PATCH",
      headers: {
        origin: "https://mathaino.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ removalPolicy: "delete" }),
    }),
    writer({ setRemovalPolicy }),
    context,
  );
  expect(patch.status).toBe(200);
  expect(setRemovalPolicy).toHaveBeenCalledWith(context, "delete");
});
