import type { LocalWhisperConfig } from "../config/local-whisper-environment.ts";

export interface LocalWhisperTranscriber {
  transcribe(wav: Uint8Array, signal?: AbortSignal): Promise<string>;
}

export class LocalWhisperUnavailableError extends Error {}
export class LocalWhisperTimeoutError extends Error {}
export class LocalWhisperCancelledError extends Error {
  override name = "LocalWhisperCancelledError";
}

export function createLocalWhisperTranscriber(
  config: Extract<LocalWhisperConfig, { enabled: true }>,
  request: typeof fetch = fetch,
): LocalWhisperTranscriber {
  return {
    async transcribe(wav, signal) {
      const controller = new AbortController();
      const cancel = () => controller.abort(signal?.reason);
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const body = new FormData();
      body.set(
        "file",
        new File([wav.slice().buffer], "recording.wav", { type: "audio/wav" }),
      );
      body.set("response_format", "json");
      try {
        const response = await request(config.endpoint, {
          method: "POST",
          body,
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.ok) throw unavailable();
        const value: unknown = await response.json();
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value) ||
          !("text" in value) ||
          typeof value.text !== "string"
        )
          throw unavailable();
        return value.text;
      } catch (error) {
        if (signal?.aborted)
          throw new LocalWhisperCancelledError(
            "Local transcription was cancelled.",
          );
        if (controller.signal.aborted)
          throw new LocalWhisperTimeoutError("Local transcription timed out.");
        if (error instanceof LocalWhisperUnavailableError) throw error;
        throw unavailable();
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
      }
    },
  };
}

function unavailable() {
  return new LocalWhisperUnavailableError(
    "Local transcription is unavailable.",
  );
}
