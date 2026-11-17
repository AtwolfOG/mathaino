import { expect, test } from "vitest";
import { readLocalWhisperEnvironment } from "@/infrastructure/config/local-whisper-environment";

test("disables local Whisper by default", () => {
  expect(readLocalWhisperEnvironment({ NODE_ENV: "development" })).toEqual({
    enabled: false,
  });
});

test("enables local Whisper only in development and fixes the inference path", () => {
  expect(
    readLocalWhisperEnvironment({
      NODE_ENV: "development",
      LOCAL_WHISPER_ENABLED: "true",
      LOCAL_WHISPER_URL: "http://127.0.0.1:8080/ignored",
    }),
  ).toEqual({
    enabled: true,
    endpoint: "http://127.0.0.1:8080/inference",
  });
  expect(
    readLocalWhisperEnvironment({
      NODE_ENV: "development",
      LOCAL_WHISPER_ENABLED: "true",
    }),
  ).toEqual({
    enabled: true,
    endpoint: "http://127.0.0.1:8080/inference",
  });
  expect(
    readLocalWhisperEnvironment({
      NODE_ENV: "development",
      LOCAL_WHISPER_ENABLED: "true",
      LOCAL_WHISPER_URL: "http://[::1]:9090",
    }),
  ).toEqual({ enabled: true, endpoint: "http://[::1]:9090/inference" });
});

test.each(["production", "test", undefined])(
  "forces local Whisper off when NODE_ENV is %s",
  (nodeEnvironment) => {
    expect(
      readLocalWhisperEnvironment({
        NODE_ENV: nodeEnvironment,
        LOCAL_WHISPER_ENABLED: "true",
        LOCAL_WHISPER_URL: "not a URL",
      }),
    ).toEqual({ enabled: false });
  },
);

test.each([
  ["yes", "http://127.0.0.1:8080", "LOCAL_WHISPER_ENABLED"],
  ["true", "http://localhost:8080", "loopback IP"],
  ["true", "http://192.168.1.2:8080", "loopback IP"],
  ["true", "https://127.0.0.1:8080", "HTTP"],
  ["true", "http://127.0.0.1", "explicit port"],
  ["true", "http://user@127.0.0.1:8080", "credentials"],
  ["true", "http://127.0.0.1:8080?model=x", "query"],
  ["true", "http://127.0.0.1:8080#fragment", "fragment"],
] as const)(
  "rejects unsafe enabled local Whisper configuration %#",
  (enabled, url, message) => {
    expect(() =>
      readLocalWhisperEnvironment({
        NODE_ENV: "development",
        LOCAL_WHISPER_ENABLED: enabled,
        LOCAL_WHISPER_URL: url,
      }),
    ).toThrow(message);
  },
);
