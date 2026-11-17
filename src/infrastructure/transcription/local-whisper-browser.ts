import {
  TranscriptionProviderError,
  type RecordedAudioInput,
  type TranscriptionProvider,
} from "../../application/transcription.ts";
import { prepareMoonshineAudio } from "./moonshine-audio.ts";
import { encodePcm16MonoWav } from "./wav.ts";

export interface LocalWhisperBrowserDependencies {
  request?: typeof fetch;
  prepareAudio?: (input: RecordedAudioInput) => Promise<Float32Array>;
}

export function createLocalWhisperBrowserProvider(
  dependencies: LocalWhisperBrowserDependencies = {},
): TranscriptionProvider {
  const request = dependencies.request ?? fetch;
  const prepareAudio = dependencies.prepareAudio ?? prepareMoonshineAudio;
  const active = new Set<AbortController>();
  const metadata = { id: "local-whisper", label: "Local Whisper" };

  return {
    ...metadata,
    requiresOnlineConsent: false,
    getCapability({ inputKind }) {
      return inputKind === "recorded-audio"
        ? { supported: true }
        : {
            supported: false,
            reason: "Local Whisper requires recorded audio.",
          };
    },
    async initialize(onUpdate) {
      onUpdate({ status: "ready", message: "Local Whisper is ready." });
    },
    async transcribe(input, signal) {
      if (input.kind !== "recorded-audio")
        throw providerError(
          "input-kind-mismatch",
          "Local Whisper requires recorded audio.",
        );
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
      active.add(controller);
      try {
        const samples = await prepareAudio(input);
        if (controller.signal.aborted) throw cancelled();
        const wav = encodePcm16MonoWav(samples);
        const body = new FormData();
        body.set(
          "file",
          new File([Uint8Array.from(wav).buffer], "recording.wav", {
            type: "audio/wav",
          }),
        );
        const response = await request("/api/local-whisper-transcriptions", {
          method: "POST",
          credentials: "same-origin",
          body,
          signal: controller.signal,
        });
        if (!response.ok) throw providerError();
        const value: unknown = await response.json();
        if (
          typeof value !== "object" ||
          value === null ||
          !("text" in value) ||
          typeof value.text !== "string"
        )
          throw providerError();
        return { text: value.text, provider: metadata };
      } catch (error) {
        if (controller.signal.aborted) throw cancelled(error);
        if (error instanceof TranscriptionProviderError) throw error;
        throw providerError("transcription-failed", undefined, error);
      } finally {
        signal.removeEventListener("abort", abort);
        active.delete(controller);
      }
    },
    async cleanup() {
      for (const controller of active) controller.abort();
    },
  };
}

function cancelled(cause?: unknown) {
  return providerError(
    "cancelled",
    "Local transcription was cancelled.",
    cause,
  );
}

function providerError(
  code: ConstructorParameters<
    typeof TranscriptionProviderError
  >[0]["code"] = "transcription-failed",
  message = "Local transcription failed.",
  cause?: unknown,
) {
  return new TranscriptionProviderError({
    code,
    message,
    recoverable: true,
    providerId: "local-whisper",
    cause,
  });
}
