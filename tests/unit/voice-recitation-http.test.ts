import { expect, test, vi } from "vitest";
import {
  RecitationConflictError,
  RecitationValidationError,
  type RecitationService,
} from "@/application/recitation";
import { handleVoiceRecitationRequest } from "@/ui/http/voice-recitation";

const userId = "00000000-0000-4000-8000-000000000001";
const itemId = "20000000-0000-4000-8000-000000000001";
const operationId = "40000000-0000-4000-8000-000000000001";
const authentication = (id: string | null) => ({ getUserId: async () => id });
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

function request(
  body: unknown = { itemId, operationId, text: "Thy word" },
  options: { origin?: string; contentType?: string } = {},
) {
  return new Request("https://mathaino.test/api/voice-recitation-attempts", {
    method: "POST",
    headers: {
      origin: options.origin ?? "https://mathaino.test",
      "content-type": options.contentType ?? "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("authenticates and submits an exact JSON transcript as server-owned voice mode", async () => {
  const submit = vi.fn<RecitationService["submit"]>().mockResolvedValue(result);
  const context = authentication(userId);
  const response = await handleVoiceRecitationRequest(
    request(),
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
    mode: "voice",
  });
});

test("rejects anonymous requests before invoking the service", async () => {
  const submit = vi.fn<RecitationService["submit"]>();
  const response = await handleVoiceRecitationRequest(
    request(),
    { submit },
    authentication(null),
  );
  expect(response.status).toBe(401);
  expect(submit).not.toHaveBeenCalled();
});

test.each([
  [{ itemId, operationId, text: "Thy word", mode: "typing" }, 400],
  [{ itemId: "bad", operationId, text: "Thy word" }, 400],
  [{ itemId, operationId: "bad", text: "Thy word" }, 400],
  [{ itemId, operationId, text: "   " }, 400],
  [{ itemId, operationId, text: "word ".repeat(1_001) }, 400],
  [{ itemId, operationId, text: "x".repeat(10_001) }, 400],
] as const)("rejects invalid transcript request %#", async (body, status) => {
  const submit = vi.fn<RecitationService["submit"]>();
  const response = await handleVoiceRecitationRequest(
    request(body),
    { submit },
    authentication(userId),
  );
  expect(response.status).toBe(status);
  expect(submit).not.toHaveBeenCalled();
});

test("rejects multipart audio without reading or submitting it", async () => {
  const submit = vi.fn<RecitationService["submit"]>();
  const response = await handleVoiceRecitationRequest(
    request({}, { contentType: "multipart/form-data" }),
    { submit },
    authentication(userId),
  );
  expect(response.status).toBe(415);
  expect(submit).not.toHaveBeenCalled();
});

test("stops reading an undeclared oversized JSON body", async () => {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(new Uint8Array(50_001));
        return;
      }
      if (pulls <= 3) controller.enqueue(new Uint8Array([1]));
      else controller.close();
    },
  });
  const oversized = new Request(
    "https://mathaino.test/api/voice-recitation-attempts",
    {
      method: "POST",
      headers: {
        origin: "https://mathaino.test",
        "content-type": "application/json",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );
  const submit = vi.fn<RecitationService["submit"]>();

  const response = await handleVoiceRecitationRequest(
    oversized,
    { submit },
    authentication(userId),
  );

  expect(response.status).toBe(413);
  expect(pulls).toBeLessThanOrEqual(2);
  expect(submit).not.toHaveBeenCalled();
});

test.each([
  [new RecitationValidationError("Invalid transcript."), 400],
  [new RecitationConflictError("Operation conflict."), 409],
] as const)("maps recitation failures", async (error, status) => {
  const response = await handleVoiceRecitationRequest(
    request(),
    { submit: async () => Promise.reject(error) },
    authentication(userId),
  );
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual({ error: error.message });
});
