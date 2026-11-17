import { expect, test, vi } from "vitest";
import {
  createLocalWhisperTranscriber,
  LocalWhisperTimeoutError,
  LocalWhisperUnavailableError,
} from "@/infrastructure/transcription/local-whisper-server";

const config = {
  enabled: true as const,
  endpoint: "http://127.0.0.1:8080/inference",
};
const wav = new Uint8Array([82, 73, 70, 70]);

test("sends only a WAV file and JSON response format to whisper.cpp", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ text: "Thy word is truth." }));

  await expect(
    createLocalWhisperTranscriber(config, request).transcribe(wav),
  ).resolves.toBe("Thy word is truth.");

  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe("http://127.0.0.1:8080/inference");
  expect(init?.method).toBe("POST");
  expect(init?.redirect).toBe("error");
  expect(init?.headers).toBeUndefined();
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  const body = init?.body as FormData;
  expect([...body.keys()].sort()).toEqual(["file", "response_format"]);
  expect(body.get("response_format")).toBe("json");
  expect(body.get("file")).toBeInstanceOf(File);
  expect((body.get("file") as File).name).toBe("recording.wav");
  expect((body.get("file") as File).type).toBe("audio/wav");
});

test.each([
  new Response("private upstream details", { status: 500 }),
  Response.json({ error: "model path" }),
  Response.json({ text: 42 }),
] as const)(
  "maps unavailable or malformed responses to a safe error",
  async (response) => {
    const transcriber = createLocalWhisperTranscriber(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    await expect(transcriber.transcribe(wav)).rejects.toEqual(
      new LocalWhisperUnavailableError("Local transcription is unavailable."),
    );
  },
);

test("aborts a stalled local request at the fixed timeout", async () => {
  vi.useFakeTimers();
  const request = vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  const operation = createLocalWhisperTranscriber(config, request).transcribe(
    wav,
  );
  const rejection = expect(operation).rejects.toBeInstanceOf(
    LocalWhisperTimeoutError,
  );

  await vi.advanceTimersByTimeAsync(20_000);
  await rejection;
  vi.useRealTimers();
});

test("propagates caller cancellation to the whisper.cpp request", async () => {
  const caller = new AbortController();
  const request = vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  const operation = createLocalWhisperTranscriber(config, request).transcribe(
    wav,
    caller.signal,
  );

  caller.abort();

  await expect(operation).rejects.toMatchObject({
    name: "LocalWhisperCancelledError",
  });
  expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});
