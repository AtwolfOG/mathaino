import { expect, test, vi } from "vitest";
import {
  RecitationConflictError,
  RecitationNotFoundError,
  RecitationValidationError,
  type RecitationService,
} from "@/application/recitation";
import { handleRecitationRequest } from "@/ui/http/recitation";

const userId = "00000000-0000-4000-8000-000000000001";
const itemId = "20000000-0000-4000-8000-000000000001";
const operationId = "40000000-0000-4000-8000-000000000001";
const authentication = (id: string | null) => ({ getUserId: async () => id });
const request = (body: unknown, origin = "https://mathaino.test") =>
  new Request("https://mathaino.test/api/recitation-attempts", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const result = {
  status: "recorded" as const,
  evaluation: {
    normalizedExpected: "thy word",
    normalizedSubmitted: "thy word",
    differences: [],
    accuracy: 100,
    passed: true,
    feedback: "Perfect match: no word differences.",
  },
  progress: {
    consecutiveDays: 1,
    masteryThreshold: 3,
    mastered: false,
    practiceStreak: 1,
  },
};

test("submits typed text and returns the committed assessment", async () => {
  const submit = vi.fn<RecitationService["submit"]>().mockResolvedValue(result);
  const context = authentication(userId);
  const response = await handleRecitationRequest(
    request({ itemId, operationId, text: "Thy word" }),
    { submit },
    context,
  );

  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  await expect(response.json()).resolves.toEqual(result);
  expect(submit).toHaveBeenCalledWith(context, {
    itemId,
    operationId,
    text: "Thy word",
  });
});

test("returns an idempotent replay without creating semantics", async () => {
  const duplicate = { ...result, status: "duplicate" as const };
  const response = await handleRecitationRequest(
    request({ itemId, operationId, text: "Thy word" }),
    { submit: async () => duplicate },
    authentication(userId),
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(duplicate);
});

test("rejects anonymous, empty, malformed, excessive and cross-origin input", async () => {
  const service: RecitationService = { submit: vi.fn() };
  expect(
    (
      await handleRecitationRequest(
        request({ itemId, operationId, text: "text" }),
        service,
        authentication(null),
      )
    ).status,
  ).toBe(401);
  for (const [body, origin] of [
    [{ itemId: "bad", operationId, text: "text" }, "https://mathaino.test"],
    [{ itemId, operationId, text: "" }, "https://mathaino.test"],
    [
      { itemId, operationId, text: "text", ownerId: userId },
      "https://mathaino.test",
    ],
    [{ itemId, operationId, text: "text" }, "https://evil.test"],
  ] as const) {
    const response = await handleRecitationRequest(
      request(body, origin),
      service,
      authentication(userId),
    );
    expect(response.status).toBe(origin.includes("evil") ? 403 : 400);
  }
  expect(service.submit).not.toHaveBeenCalled();
});

test.each([
  [new RecitationValidationError("Invalid recitation."), 400],
  [new RecitationNotFoundError("Missing."), 404],
  [new RecitationConflictError("Conflict."), 409],
] as const)(
  "maps expected use-case errors without exposing internals",
  async (error, status) => {
    const response = await handleRecitationRequest(
      request({ itemId, operationId, text: "text" }),
      { submit: async () => Promise.reject(error) },
      authentication(userId),
    );
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: error.message });
  },
);
