import { expect, test, vi } from "vitest";
import {
  NoSpeechDetectedError,
  TranscriptionError,
  TranscriptionTimeoutError,
  type VoiceRecitationService,
} from "@/application/voice-recitation";
import { handleVoiceRecitationRequest } from "@/ui/http/voice-recitation";

const userId = "00000000-0000-4000-8000-000000000001";
const itemId = "20000000-0000-4000-8000-000000000001";
const operationId = "40000000-0000-4000-8000-000000000001";
const authentication = (id: string | null) => ({ getUserId: async () => id });
const result = {
  status: "recorded" as const,
  transcript: "Thy word",
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
  options: {
    type?: string;
    duration?: string;
    bytes?: number;
    content?: Uint8Array;
  } = {},
  origin = "https://mathaino.test",
) {
  const type = options.type ?? "audio/webm";
  const body = new FormData();
  body.set("itemId", itemId);
  body.set("operationId", operationId);
  body.set("durationSeconds", options.duration ?? "3.5");
  body.set(
    "audio",
    new File(
      [
        Uint8Array.from(options.content ?? audioFixture(type, options.bytes))
          .buffer,
      ],
      "recitation",
      {
        type,
      },
    ),
  );
  return new Request("https://mathaino.test/api/voice-recitation-attempts", {
    method: "POST",
    headers: { origin },
    body,
  });
}

function audioFixture(type: string, size?: number) {
  const signatures: Record<string, number[]> = {
    "audio/webm": [0x1a, 0x45, 0xdf, 0xa3],
    "audio/ogg": [0x4f, 0x67, 0x67, 0x53],
    "audio/mp4": [0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70],
    "audio/mpeg": [0x49, 0x44, 0x33],
    "audio/wav": [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
  };
  const signature = signatures[type] ?? [1, 2, 3];
  const bytes = new Uint8Array(size ?? signature.length);
  bytes.set(signature.slice(0, bytes.length));
  return bytes;
}

test("authenticates, validates and submits an ephemeral recording", async () => {
  const submit = vi
    .fn<VoiceRecitationService["submit"]>()
    .mockResolvedValue(result);
  const context = authentication(userId);
  const response = await handleVoiceRecitationRequest(
    request({ type: "audio/mp4" }),
    { submit },
    context,
  );

  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  await expect(response.json()).resolves.toEqual(result);
  expect(submit).toHaveBeenCalledWith(context, {
    itemId,
    operationId,
    recording: {
      bytes: expect.any(Uint8Array),
      mediaType: "audio/mp4",
      durationSeconds: 3.5,
    },
  });
});

test("rejects anonymous uploads before invoking the service", async () => {
  const submit = vi.fn<VoiceRecitationService["submit"]>();
  const response = await handleVoiceRecitationRequest(
    request(),
    { submit },
    authentication(null),
  );
  expect(response.status).toBe(401);
  expect(submit).not.toHaveBeenCalled();
});

test("rejects audio whose bytes do not match its declared format", async () => {
  const submit = vi.fn<VoiceRecitationService["submit"]>();
  const response = await handleVoiceRecitationRequest(
    request({ content: new Uint8Array([1, 2, 3, 4]) }),
    { submit },
    authentication(userId),
  );
  expect(response.status).toBe(415);
  expect(submit).not.toHaveBeenCalled();
});

test.each([
  [{ type: "audio/aac" }, 415],
  [{ duration: "0" }, 400],
  [{ duration: "121" }, 400],
  [{ bytes: 5_000_001 }, 413],
] as const)("rejects invalid audio upload %#", async (options, status) => {
  const submit = vi.fn<VoiceRecitationService["submit"]>();
  const response = await handleVoiceRecitationRequest(
    request(options),
    { submit },
    authentication(userId),
  );
  expect(response.status).toBe(status);
  expect(submit).not.toHaveBeenCalled();
});

test.each([
  [new NoSpeechDetectedError("No speech was detected."), 422],
  [new TranscriptionTimeoutError("Transcription timed out."), 504],
  [new TranscriptionError("Transcription provider failed."), 502],
] as const)(
  "maps transcription failures to recovery responses",
  async (error, status) => {
    const response = await handleVoiceRecitationRequest(
      request(),
      { submit: async () => Promise.reject(error) },
      authentication(userId),
    );
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: error.message });
  },
);
