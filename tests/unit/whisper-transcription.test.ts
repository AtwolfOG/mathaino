import { expect, test, vi } from "vitest";
import {
  TranscriptionError,
  TranscriptionTimeoutError,
} from "@/application/voice-recitation";
import { createWhisperTranscriptionProvider } from "@/infrastructure/transcription/whisper";

const config = {
  endpoint: "https://speech.example.test/v1/audio/transcriptions",
  apiKey: "server-secret",
  model: "whisper-1",
  timeoutMilliseconds: 50,
};
const recording = {
  bytes: new Uint8Array([1, 2, 3]),
  mediaType: "audio/ogg",
  durationSeconds: 3,
};

test("sends varying browser audio formats to a Whisper-compatible provider", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ text: "Thy word is a lamp.", duration: 3 }),
    );
  const provider = createWhisperTranscriptionProvider(config, request);

  await expect(provider.transcribe(recording)).resolves.toBe(
    "Thy word is a lamp.",
  );
  expect(request).toHaveBeenCalledOnce();
  const [url, options] = request.mock.calls[0]!;
  expect(url).toBe(config.endpoint);
  expect(options?.headers).toEqual({ authorization: "Bearer server-secret" });
  expect(options?.body).toBeInstanceOf(FormData);
  const body = options?.body as FormData;
  expect(body.get("model")).toBe("whisper-1");
  expect(body.get("response_format")).toBe("verbose_json");
  expect(body.get("file")).toBeInstanceOf(File);
  expect((body.get("file") as File).type).toBe("audio/ogg");
});

test("rejects provider-measured audio outside the duration limit", async () => {
  const provider = createWhisperTranscriptionProvider(
    config,
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ text: "Thy word", duration: 121 })),
  );
  await expect(provider.transcribe(recording)).rejects.toEqual(
    new TranscriptionError(
      "Transcription provider returned an invalid response.",
    ),
  );
});

test("maps provider errors without exposing provider response details", async () => {
  const provider = createWhisperTranscriptionProvider(
    config,
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("upstream account details", { status: 500 }),
      ),
  );
  await expect(provider.transcribe(recording)).rejects.toEqual(
    new TranscriptionError("Transcription provider failed."),
  );
});

test("aborts transcription after the configured timeout", async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(options.signal?.reason),
        );
      }),
  );
  const provider = createWhisperTranscriptionProvider(
    { ...config, timeoutMilliseconds: 1 },
    request,
  );
  await expect(provider.transcribe(recording)).rejects.toBeInstanceOf(
    TranscriptionTimeoutError,
  );
});
