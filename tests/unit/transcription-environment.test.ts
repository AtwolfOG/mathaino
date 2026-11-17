import { expect, test } from "vitest";
import { readTranscriptionEnvironment } from "@/infrastructure/config/transcription-environment";

test("reads server-only Whisper-compatible provider configuration", () => {
  expect(
    readTranscriptionEnvironment({
      TRANSCRIPTION_API_URL:
        "https://speech.example.test/v1/audio/transcriptions",
      TRANSCRIPTION_API_KEY: "provider-secret",
      TRANSCRIPTION_MODEL: "whisper-1",
    }),
  ).toEqual({
    endpoint: "https://speech.example.test/v1/audio/transcriptions",
    apiKey: "provider-secret",
    model: "whisper-1",
  });
});

test.each([
  [{}, "TRANSCRIPTION_API_URL"],
  [
    {
      TRANSCRIPTION_API_URL: "http://speech.example.test/transcriptions",
      TRANSCRIPTION_API_KEY: "secret",
      TRANSCRIPTION_MODEL: "whisper-1",
    },
    "HTTPS",
  ],
  [
    {
      TRANSCRIPTION_API_URL: "https://speech.example.test/transcriptions",
      TRANSCRIPTION_API_KEY: "",
      TRANSCRIPTION_MODEL: "whisper-1",
    },
    "TRANSCRIPTION_API_KEY",
  ],
] as const)(
  "rejects unsafe provider configuration %#",
  (environment, message) => {
    expect(() => readTranscriptionEnvironment(environment)).toThrow(message);
  },
);
