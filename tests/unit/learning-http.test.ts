import { expect, test, vi } from "vitest";
import type { LearningReader } from "@/application/learning-reader";
import type { LearningWriter } from "@/application/learning-writer";
import { handleLearningRequest } from "@/ui/http/learning";

const reader: LearningReader = {
  list: async () => [],
  find: async () => null,
};
const authentication = (userId: string | null) => ({
  getUserId: async () => userId,
});
const userId = "00000000-0000-4000-8000-000000000001";
const reference = {
  bookId: "genesis",
  chapterId: "1",
  verseNumber: "1",
};
const request = (body: unknown, origin = "https://mathaino.test") =>
  new Request("https://mathaino.test/api/learning-items", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("an authenticated learner can save a validated verse selection", async () => {
  const add = vi.fn<LearningWriter["add"]>().mockResolvedValue({
    added: 1,
    existing: 1,
    restored: 0,
  });
  const context = authentication(userId);
  const response = await handleLearningRequest(
    request({ references: [reference, { ...reference, verseNumber: "2" }] }),
    reader,
    context,
    undefined,
    writer({ add }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    added: 1,
    existing: 1,
    restored: 0,
  });
  expect(add).toHaveBeenCalledWith(context, expect.any(Array));
});

test("learning mutations reject anonymous, cross-origin, and owner-supplied input", async () => {
  const add = vi.fn<LearningWriter["add"]>();
  const anonymous = await handleLearningRequest(
    request({ references: [reference] }),
    reader,
    authentication(null),
    undefined,
    writer({ add }),
  );
  expect(anonymous.status).toBe(401);

  const crossOrigin = await handleLearningRequest(
    request({ references: [reference] }, "https://evil.test"),
    reader,
    authentication(userId),
    undefined,
    writer({ add }),
  );
  expect(crossOrigin.status).toBe(403);

  const forgedOwner = await handleLearningRequest(
    request({ references: [reference], userId: "forged" }),
    reader,
    authentication(userId),
    undefined,
    writer({ add }),
  );
  expect(forgedOwner.status).toBe(400);
  expect(add).not.toHaveBeenCalled();
});

test.each([
  { body: {}, status: 400 },
  { body: { references: [] }, status: 400 },
  {
    body: {
      references: [{ bookId: "../genesis", chapterId: "1", verseNumber: "1" }],
    },
    status: 400,
  },
])("invalid learning selection returns $status", async ({ body, status }) => {
  const response = await handleLearningRequest(
    request(body),
    reader,
    authentication(userId),
    undefined,
    writer({ add: async () => ({ added: 0, existing: 0, restored: 0 }) }),
  );
  expect(response.status).toBe(status);
});

test("oversized learning selections are rejected before parsing", async () => {
  const response = await handleLearningRequest(
    new Request("https://mathaino.test/api/learning-items", {
      method: "POST",
      headers: {
        origin: "https://mathaino.test",
        "content-type": "application/json",
        "content-length": "20001",
      },
      body: JSON.stringify({ references: [reference] }),
    }),
    reader,
    authentication(userId),
    undefined,
    writer({ add: async () => ({ added: 0, existing: 0, restored: 0 }) }),
  );

  expect(response.status).toBe(413);
});

function writer(overrides: Partial<LearningWriter>): LearningWriter {
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

test("unsupported methods advertise the available learning operations", async () => {
  const response = await handleLearningRequest(
    new Request("https://mathaino.test/api/learning-items", { method: "PUT" }),
    reader,
    authentication(userId),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("GET, POST");
});

test("an owned learning item can be archived, deleted, or restored", async () => {
  const id = "20000000-0000-4000-8000-000000000001";
  const context = authentication(userId);
  const remove = vi.fn<LearningWriter["remove"]>().mockResolvedValue("archive");
  const restore = vi.fn<LearningWriter["restore"]>().mockResolvedValue(true);
  const mutation = (method: string, body: unknown) =>
    new Request(`https://mathaino.test/api/learning-items/${id}`, {
      method,
      headers: {
        origin: "https://mathaino.test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  const archived = await handleLearningRequest(
    mutation("DELETE", { policy: "archive" }),
    reader,
    context,
    id,
    writer({ remove, restore }),
  );
  expect(archived.status).toBe(200);
  await expect(archived.json()).resolves.toEqual({ removed: "archive" });
  expect(remove).toHaveBeenCalledWith(context, id, "archive");

  const restored = await handleLearningRequest(
    mutation("PATCH", { archived: false }),
    reader,
    context,
    id,
    writer({ remove, restore }),
  );
  expect(restored.status).toBe(200);
  await expect(restored.json()).resolves.toEqual({ restored: true });
});

test("foreign learning-item mutations return not found", async () => {
  const id = "20000000-0000-4000-8000-000000000001";
  const response = await handleLearningRequest(
    new Request(`https://mathaino.test/api/learning-items/${id}`, {
      method: "DELETE",
      headers: {
        origin: "https://mathaino.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ policy: "delete" }),
    }),
    reader,
    authentication(userId),
    id,
    writer({ remove: async () => null }),
  );
  expect(response.status).toBe(404);
});

test("an item mastery threshold override can be set or cleared", async () => {
  const id = "20000000-0000-4000-8000-000000000001";
  const context = authentication(userId);
  const setMasteryThresholdOverride = vi
    .fn<LearningWriter["setMasteryThresholdOverride"]>()
    .mockResolvedValue(true);
  const patch = (masteryThreshold: number | null) =>
    new Request(`https://mathaino.test/api/learning-items/${id}`, {
      method: "PATCH",
      headers: {
        origin: "https://mathaino.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ masteryThreshold }),
    });

  const response = await handleLearningRequest(
    patch(5),
    reader,
    context,
    id,
    writer({ setMasteryThresholdOverride }),
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ masteryThreshold: 5 });
  expect(setMasteryThresholdOverride).toHaveBeenCalledWith(context, id, 5);

  const invalid = await handleLearningRequest(
    patch(31),
    reader,
    context,
    id,
    writer({ setMasteryThresholdOverride }),
  );
  expect(invalid.status).toBe(400);
});
