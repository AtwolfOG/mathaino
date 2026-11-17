import type {
  AudioRecording,
  TranscriptionProvider,
} from "../../application/voice-recitation.ts";
import {
  TranscriptionError,
  TranscriptionTimeoutError,
} from "../../application/voice-recitation.ts";

export interface WhisperConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMilliseconds?: number;
}

export function createWhisperTranscriptionProvider(
  config: WhisperConfig,
  request: typeof fetch = fetch,
): TranscriptionProvider {
  return {
    transcribe: async (recording: AudioRecording) => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        config.timeoutMilliseconds ?? 20_000,
      );
      const body = new FormData();
      body.set("model", config.model);
      body.set("response_format", "verbose_json");
      body.set(
        "file",
        new File(
          [Uint8Array.from(recording.bytes).buffer],
          audioFilename(recording.mediaType),
          { type: recording.mediaType },
        ),
      );
      try {
        const response = await request(config.endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}` },
          body,
          signal: controller.signal,
        });
        if (!response.ok)
          throw new TranscriptionError("Transcription provider failed.");
        const value: unknown = await response.json();
        if (
          typeof value !== "object" ||
          value === null ||
          !("text" in value) ||
          typeof value.text !== "string" ||
          !("duration" in value) ||
          typeof value.duration !== "number" ||
          !Number.isFinite(value.duration) ||
          value.duration < 0.25 ||
          value.duration > 120
        )
          throw new TranscriptionError(
            "Transcription provider returned an invalid response.",
          );
        return value.text;
      } catch (error) {
        if (controller.signal.aborted)
          throw new TranscriptionTimeoutError("Transcription timed out.");
        if (error instanceof TranscriptionError) throw error;
        throw new TranscriptionError("Transcription provider failed.");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function audioFilename(mediaType: string) {
  const extensions: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
  };
  return `recitation.${extensions[mediaType] ?? "audio"}`;
}
