import { expect, test, vi } from "vitest";
import {
  TranscriptionManager,
  TranscriptionProviderError,
  validateRecordedAudioSize,
  type TranscriptionInput,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "@/application/transcription";

test("enforces the recorded audio size boundary before transcription", () => {
  expect(() => validateRecordedAudioSize(5_000_000)).not.toThrow();
  expect(() => validateRecordedAudioSize(5_000_001)).toThrow(
    "Recorded audio must be 5 MB or smaller.",
  );
});

const recordedAudio: TranscriptionInput = {
  kind: "recorded-audio",
  bytes: new Uint8Array([1, 2, 3]),
  mediaType: "audio/webm",
  durationSeconds: 2,
};

function provider(
  overrides: Partial<TranscriptionProvider> = {},
): TranscriptionProvider {
  return {
    id: "local",
    label: "Local transcription",
    requiresOnlineConsent: false,
    getCapability: vi.fn().mockReturnValue({ supported: true }),
    initialize: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockResolvedValue({
      text: "Thy word",
      provider: { id: "wrong", label: "Wrong metadata" },
    }),
    cleanup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

test("selects an explicit capable provider and normalizes its result metadata", async () => {
  const local = provider();
  const onUpdate = vi.fn();
  const manager = new TranscriptionManager([local]);

  await expect(
    manager.initialize({
      providerId: "local",
      inputKind: "recorded-audio",
      runtimeHints: { wasm: true, availableMemoryMb: 512 },
      onUpdate,
    }),
  ).resolves.toEqual({ supported: true });
  await expect(manager.transcribe(recordedAudio)).resolves.toEqual({
    text: "Thy word",
    provider: { id: "local", label: "Local transcription" },
  });
  expect(local.getCapability).toHaveBeenCalledWith({
    inputKind: "recorded-audio",
    runtimeHints: { wasm: true, availableMemoryMb: 512 },
  });
  expect(local.initialize).toHaveBeenCalledWith(onUpdate);
  expect(manager.selectedProvider).toEqual({
    id: "local",
    label: "Local transcription",
  });
});

test("reports an unsupported capability reason without initializing", async () => {
  const local = provider({
    getCapability: vi.fn().mockReturnValue({
      supported: false,
      reason: "This runtime has no WebAssembly support.",
    }),
  });
  const manager = new TranscriptionManager([local]);

  await expect(
    manager.initialize({
      providerId: "local",
      inputKind: "live-speech",
    }),
  ).rejects.toMatchObject({
    code: "provider-unsupported",
    recoverable: true,
    providerId: "local",
    message: "This runtime has no WebAssembly support.",
  });
  expect(local.initialize).not.toHaveBeenCalled();
});

test("rechecks a recoverable unsupported capability after an external install", async () => {
  const getCapability = vi
    .fn()
    .mockResolvedValueOnce({ supported: false, reason: "Download required." })
    .mockResolvedValueOnce({ supported: true });
  const local = provider({ getCapability });
  const manager = new TranscriptionManager([local]);

  await expect(
    manager.initialize({ providerId: "local", inputKind: "live-speech" }),
  ).rejects.toMatchObject({ code: "provider-unsupported" });
  await expect(
    manager.initialize({ providerId: "local", inputKind: "live-speech" }),
  ).resolves.toEqual({ supported: true });
  expect(getCapability).toHaveBeenCalledTimes(2);
});

test("never selects an online-consent provider without explicit consent", async () => {
  const online = provider({
    id: "online",
    label: "Online transcription",
    requiresOnlineConsent: true,
  });
  const manager = new TranscriptionManager([online]);

  await expect(
    manager.initialize({
      providerId: "online",
      inputKind: "recorded-audio",
    }),
  ).rejects.toMatchObject({
    code: "consent-required",
    recoverable: true,
    providerId: "online",
  });
  expect(online.getCapability).not.toHaveBeenCalled();
  expect(online.initialize).not.toHaveBeenCalled();
});

test("requires active transcription to be safely cancelled before switching", async () => {
  const cancelled = new TranscriptionProviderError({
    code: "cancelled",
    message: "Transcription was cancelled.",
    recoverable: true,
    providerId: "local",
  });
  const local = provider({
    transcribe: vi.fn((_input, signal) => {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(cancelled), {
          once: true,
        });
      });
    }),
  });
  const other = provider({ id: "other", label: "Other provider" });
  const manager = new TranscriptionManager([local, other]);
  await manager.initialize({
    providerId: "local",
    inputKind: "recorded-audio",
  });
  const operation = manager.transcribe(recordedAudio);
  const operationResult = expect(operation).rejects.toBe(cancelled);

  await expect(
    manager.initialize({
      providerId: "other",
      inputKind: "recorded-audio",
    }),
  ).rejects.toMatchObject({ code: "provider-busy", recoverable: true });
  expect(other.initialize).not.toHaveBeenCalled();

  await manager.cancelActiveTranscription();
  await operationResult;
  await expect(
    manager.initialize({
      providerId: "other",
      inputKind: "recorded-audio",
    }),
  ).resolves.toEqual({ supported: true });
});

test("does not retry a failed provider in the same manager session and preserves its error", async () => {
  const failure = new TranscriptionProviderError({
    code: "initialization-failed",
    message: "Model initialization failed.",
    recoverable: true,
    providerId: "local",
  });
  const local = provider({
    initialize: vi.fn().mockRejectedValue(failure),
  });
  const online = provider({
    id: "online",
    label: "Online transcription",
    requiresOnlineConsent: true,
  });
  const manager = new TranscriptionManager([local, online]);

  await expect(
    manager.initialize({
      providerId: "local",
      inputKind: "recorded-audio",
    }),
  ).rejects.toBe(failure);
  await expect(
    manager.initialize({
      providerId: "local",
      inputKind: "recorded-audio",
    }),
  ).rejects.toBe(failure);
  expect(local.initialize).toHaveBeenCalledOnce();
  expect(online.getCapability).not.toHaveBeenCalled();
  expect(online.initialize).not.toHaveBeenCalled();
});

test("allows an explicit retry after a recoverable per-attempt failure", async () => {
  const failure = new TranscriptionProviderError({
    code: "no-speech",
    message: "No speech was recognized.",
    recoverable: true,
    providerId: "local",
  });
  const local = provider({
    transcribe: vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({
        text: "Thy word",
        provider: { id: "local", label: "Local transcription" },
      }),
  });
  const manager = new TranscriptionManager([local]);
  await manager.initialize({
    providerId: "local",
    inputKind: "recorded-audio",
  });

  await expect(manager.transcribe(recordedAudio)).rejects.toBe(failure);
  await expect(manager.transcribe(recordedAudio)).resolves.toMatchObject({
    text: "Thy word",
  });
  expect(local.transcribe).toHaveBeenCalledTimes(2);
});

test("cleanup cancels active work, waits for it to settle, and releases the provider", async () => {
  const local = provider({
    transcribe: vi.fn((_input, signal) => {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () =>
            reject(
              new TranscriptionProviderError({
                code: "cancelled",
                message: "Transcription was cancelled.",
                recoverable: true,
                providerId: "local",
              }),
            ),
          { once: true },
        );
      });
    }),
  });
  const manager = new TranscriptionManager([local]);
  await manager.initialize({
    providerId: "local",
    inputKind: "recorded-audio",
  });
  const operation = manager.transcribe(recordedAudio);
  const operationResult = expect(operation).rejects.toMatchObject({
    code: "cancelled",
  });

  await manager.cleanup();

  await operationResult;
  expect(local.cleanup).toHaveBeenCalledOnce();
  expect(manager.selectedProvider).toBeUndefined();
});

test("stop finalizes a live provider without cancelling its active transcription", async () => {
  let finish:
    | ((value: {
        text: string;
        provider: { id: string; label: string };
      }) => void)
    | undefined;
  const stop = vi.fn(() =>
    finish?.({
      text: "Thy word",
      provider: { id: "local", label: "Local transcription" },
    }),
  );
  const local = provider({
    stop,
    transcribe: vi.fn(
      () =>
        new Promise<TranscriptionResult>((resolve) => {
          finish = resolve;
        }),
    ),
  });
  const manager = new TranscriptionManager([local]);
  await manager.initialize({
    providerId: "local",
    inputKind: "live-speech",
  });
  const operation = manager.transcribe({ kind: "live-speech" });

  manager.stopActiveTranscription();

  expect(stop).toHaveBeenCalledOnce();
  await expect(operation).resolves.toMatchObject({ text: "Thy word" });
});

test("cancels pending initialization through provider cleanup", async () => {
  const cancelled = new TranscriptionProviderError({
    code: "cancelled",
    message: "Initialization cancelled.",
    recoverable: true,
    providerId: "local",
  });
  let rejectInitialization: ((error: unknown) => void) | undefined;
  const local = provider({
    initialize: vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectInitialization = reject;
        }),
    ),
    cleanup: vi.fn(async () => rejectInitialization?.(cancelled)),
  });
  const manager = new TranscriptionManager([local]);
  const initialization = manager.initialize({
    providerId: "local",
    inputKind: "recorded-audio",
  });
  await vi.waitFor(() => expect(local.initialize).toHaveBeenCalledOnce());

  await manager.cancelPendingInitialization();

  await expect(initialization).rejects.toBe(cancelled);
  expect(local.cleanup).toHaveBeenCalledOnce();
  expect(manager.selectedProvider).toBeUndefined();
});
