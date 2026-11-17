import { expect, test, vi } from "vitest";
import { TranscriptionProviderError } from "@/application/transcription";
import { createLocalWhisperBrowserProvider } from "@/infrastructure/transcription/local-whisper-browser";

const input = {
  kind: "recorded-audio" as const,
  bytes: new Uint8Array([1, 2, 3]),
  mediaType: "audio/webm",
  durationSeconds: 1,
};

test("prepares recorded audio and uploads only WAV to the same-origin route", async () => {
  const prepareAudio = vi.fn().mockResolvedValue(new Float32Array(16_000));
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ text: "Thy word" }));
  const provider = createLocalWhisperBrowserProvider({ request, prepareAudio });

  expect(provider.id).toBe("local-whisper");
  expect(provider.requiresOnlineConsent).toBe(false);
  expect(
    await provider.getCapability({
      inputKind: "recorded-audio",
      runtimeHints: {},
    }),
  ).toEqual({ supported: true });
  await provider.initialize(() => undefined);
  await expect(
    provider.transcribe(input, new AbortController().signal),
  ).resolves.toEqual({
    text: "Thy word",
    provider: { id: "local-whisper", label: "Local Whisper" },
  });

  expect(prepareAudio).toHaveBeenCalledWith(input);
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe("/api/local-whisper-transcriptions");
  expect(init?.method).toBe("POST");
  expect(init?.credentials).toBe("same-origin");
  expect(init?.headers).toBeUndefined();
  const body = init?.body as FormData;
  expect([...body.keys()]).toEqual(["file"]);
  const file = body.get("file") as File;
  expect(file.type).toBe("audio/wav");
  expect(file.size).toBe(44 + 32_000);
});

test("cancels an active browser request through its supplied signal", async () => {
  const request = abortableRequest();
  const provider = createLocalWhisperBrowserProvider({
    request,
    prepareAudio: async () => new Float32Array(16_000),
  });
  const controller = new AbortController();
  const operation = provider.transcribe(input, controller.signal);
  controller.abort();

  await expect(operation).rejects.toMatchObject({
    code: "cancelled",
    providerId: "local-whisper",
  });
});

test("cleanup aborts active requests and leaves the provider reusable", async () => {
  const request = abortableRequest();
  const provider = createLocalWhisperBrowserProvider({
    request,
    prepareAudio: async () => new Float32Array(16_000),
  });
  const operation = provider.transcribe(input, new AbortController().signal);
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  await provider.cleanup();

  await expect(operation).rejects.toBeInstanceOf(TranscriptionProviderError);
  expect(request.mock.calls[0]![1]?.signal?.aborted).toBe(true);
});

function abortableRequest() {
  return vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
}
