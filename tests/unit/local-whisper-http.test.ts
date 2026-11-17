import { expect, test, vi } from "vitest";
import {
  LocalWhisperTimeoutError,
  LocalWhisperUnavailableError,
  type LocalWhisperTranscriber,
} from "@/infrastructure/transcription/local-whisper-server";
import { encodePcm16MonoWav } from "@/infrastructure/transcription/wav";
import { handleLocalWhisperTranscriptionRequest } from "@/ui/http/local-whisper-transcriptions";

const authentication = (userId: string | null) => ({
  getUserId: async () => userId,
});
const userId = "00000000-0000-4000-8000-000000000001";

function request(
  bytes = encodePcm16MonoWav(new Float32Array(16_000)),
  options: {
    origin?: string;
    field?: string;
    type?: string;
    method?: string;
  } = {},
) {
  const body = new FormData();
  body.set(
    options.field ?? "file",
    new File([bytes.slice().buffer], "recording.wav", {
      type: options.type ?? "audio/wav",
    }),
  );
  return new Request("https://mathaino.test/api/local-whisper-transcriptions", {
    method: options.method ?? "POST",
    headers: { origin: options.origin ?? "https://mathaino.test" },
    body,
  });
}

test("authenticates and proxies one validated WAV file", async () => {
  const transcribe = vi
    .fn<LocalWhisperTranscriber["transcribe"]>()
    .mockResolvedValue("Thy word");
  const response = await handleLocalWhisperTranscriptionRequest(
    request(),
    { transcribe },
    authentication(userId),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  await expect(response.json()).resolves.toEqual({ text: "Thy word" });
  expect(transcribe).toHaveBeenCalledWith(
    expect.any(Uint8Array),
    expect.any(AbortSignal),
  );
});

test("returns a private 404 without contacting a transcriber when disabled", async () => {
  const response = await handleLocalWhisperTranscriptionRequest(
    request(),
    undefined,
    authentication(userId),
  );
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("rejects anonymous and cross-origin requests before transcription", async () => {
  const transcribe = vi.fn<LocalWhisperTranscriber["transcribe"]>();
  expect(
    (
      await handleLocalWhisperTranscriptionRequest(
        request(),
        { transcribe },
        authentication(null),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await handleLocalWhisperTranscriptionRequest(
        request(undefined, { origin: "https://evil.test" }),
        { transcribe },
        authentication(userId),
      )
    ).status,
  ).toBe(403);
  expect(transcribe).not.toHaveBeenCalled();
});

test.each([
  [request(undefined, { field: "audio" }), 400],
  [request(undefined, { type: "application/octet-stream" }), 415],
  [request(new Uint8Array([82, 73, 70, 70])), 415],
  [request(encodePcm16MonoWav(new Float32Array(3_999))), 400],
  [request(encodePcm16MonoWav(new Float32Array(1_920_001))), 413],
] as const)(
  "rejects invalid local WAV input %#",
  async (invalidRequest, status) => {
    const transcribe = vi.fn<LocalWhisperTranscriber["transcribe"]>();
    const response = await handleLocalWhisperTranscriptionRequest(
      invalidRequest,
      { transcribe },
      authentication(userId),
    );
    expect(response.status).toBe(status);
    expect(transcribe).not.toHaveBeenCalled();
  },
);

test("stops reading an undeclared oversized multipart upload", async () => {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(new Uint8Array(3_940_045));
        return;
      }
      if (pulls <= 3) controller.enqueue(new Uint8Array([1]));
      else controller.close();
    },
  });
  const oversized = new Request(
    "https://mathaino.test/api/local-whisper-transcriptions",
    {
      method: "POST",
      headers: {
        origin: "https://mathaino.test",
        "content-type": "multipart/form-data; boundary=test",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );
  const transcribe = vi.fn<LocalWhisperTranscriber["transcribe"]>();

  const response = await handleLocalWhisperTranscriptionRequest(
    oversized,
    { transcribe },
    authentication(userId),
  );

  expect(response.status).toBe(413);
  expect(pulls).toBeLessThanOrEqual(2);
  expect(transcribe).not.toHaveBeenCalled();
});

test.each([
  [
    new LocalWhisperUnavailableError("hidden"),
    502,
    "Local transcription is unavailable.",
  ],
  [
    new LocalWhisperTimeoutError("hidden"),
    504,
    "Local transcription timed out.",
  ],
] as const)(
  "maps local process failures safely",
  async (error, status, message) => {
    const response = await handleLocalWhisperTranscriptionRequest(
      request(),
      { transcribe: async () => Promise.reject(error) },
      authentication(userId),
    );
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
  },
);
