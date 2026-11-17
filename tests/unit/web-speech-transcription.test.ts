import { expect, test, vi } from "vitest";
import type { TranscriptionProvider } from "@/application/transcription";
import {
  createNativeWebSpeechTranscriptionProvider,
  createOnlineWebSpeechTranscriptionProvider,
  type NativeSpeechAvailability,
} from "@/infrastructure/transcription/web-speech";

class FakeRecognition {
  lang = "";
  continuous = true;
  interimResults = true;
  maxAlternatives = 2;
  processLocally?: boolean;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn();
  readonly abort = vi.fn();

  result(...transcripts: string[]) {
    this.onresult?.({
      resultIndex: 0,
      results: transcripts.map((transcript) =>
        Object.assign([{ transcript }], { isFinal: true }),
      ),
    });
  }

  error(error: string) {
    this.onerror?.({ error });
  }

  end() {
    this.onend?.();
  }
}

function speechRuntime(options?: {
  availability?: NativeSpeechAvailability;
  installResult?: boolean;
  installError?: unknown;
  processLocally?: boolean;
  staticApis?: boolean;
  prefixed?: boolean;
}) {
  const instances: FakeRecognition[] = [];
  const Recognition = class extends FakeRecognition {
    static available = vi
      .fn()
      .mockResolvedValue(options?.availability ?? "available");
    static install = options?.installError
      ? vi.fn().mockRejectedValue(options.installError)
      : vi.fn().mockResolvedValue(options?.installResult ?? true);

    constructor() {
      super();
      if (options?.processLocally === false) {
        Reflect.deleteProperty(this, "processLocally");
      } else {
        this.processLocally = false;
      }
      instances.push(this);
    }
  };
  if (options?.staticApis === false) {
    Reflect.deleteProperty(Recognition, "available");
    Reflect.deleteProperty(Recognition, "install");
  }
  const global = options?.prefixed
    ? { webkitSpeechRecognition: Recognition }
    : { SpeechRecognition: Recognition };
  return { global, Recognition, instances };
}

const liveSpeech = { kind: "live-speech" as const };

test("both providers reject unsupported browsers and non-live input", async () => {
  const providers: TranscriptionProvider[] = [
    createNativeWebSpeechTranscriptionProvider({ global: {} }),
    createOnlineWebSpeechTranscriptionProvider({ global: {} }),
  ];

  for (const provider of providers) {
    await expect(
      provider.getCapability({ inputKind: "live-speech", runtimeHints: {} }),
    ).resolves.toMatchObject({ supported: false });
    await expect(
      provider.getCapability({ inputKind: "recorded-audio", runtimeHints: {} }),
    ).resolves.toMatchObject({ supported: false });
  }
});

test("native requires processLocally and both static on-device APIs", async () => {
  const noLocalProperty = speechRuntime({ processLocally: false });
  const noStaticApis = speechRuntime({ staticApis: false });

  for (const global of [noLocalProperty.global, noStaticApis.global]) {
    const provider = createNativeWebSpeechTranscriptionProvider({ global });
    await expect(
      provider.getCapability({ inputKind: "live-speech", runtimeHints: {} }),
    ).resolves.toMatchObject({ supported: false });
  }
  expect(noLocalProperty.Recognition.available).not.toHaveBeenCalled();
});

test.each([
  ["available", true],
  ["downloading", false],
  ["downloadable", false],
  ["unavailable", false],
] as const)(
  "represents native %s availability",
  async (availability, supported) => {
    const runtime = speechRuntime({ availability });
    const provider = createNativeWebSpeechTranscriptionProvider({
      global: runtime.global,
    });

    await expect(provider.getEnglishAvailability()).resolves.toBe(availability);
    await expect(
      provider.getCapability({ inputKind: "live-speech", runtimeHints: {} }),
    ).resolves.toMatchObject({ supported });
    expect(runtime.Recognition.available).toHaveBeenCalledWith({
      langs: ["en-US"],
      processLocally: true,
      quality: "dictation",
    });
  },
);

test.each([true, false])(
  "installs English only through the explicit action and returns %s",
  async (installResult) => {
    const runtime = speechRuntime({
      availability: "downloadable",
      installResult,
    });
    const provider = createNativeWebSpeechTranscriptionProvider({
      global: runtime.global,
    });

    await provider.getCapability({
      inputKind: "live-speech",
      runtimeHints: {},
    });
    expect(runtime.Recognition.install).not.toHaveBeenCalled();
    await expect(provider.installEnglishLanguagePack()).resolves.toBe(
      installResult,
    );
    expect(runtime.Recognition.install).toHaveBeenCalledWith({
      langs: ["en-US"],
      processLocally: true,
      quality: "dictation",
    });
    await provider.getCapability({
      inputKind: "live-speech",
      runtimeHints: {},
    });
    expect(runtime.Recognition.available).toHaveBeenCalledTimes(2);
  },
);

test("maps a rejected English installation to a stable error", async () => {
  const runtime = speechRuntime({ installError: new Error("install failed") });
  const provider = createNativeWebSpeechTranscriptionProvider({
    global: runtime.global,
  });

  await expect(provider.installEnglishLanguagePack()).rejects.toMatchObject({
    code: "language-pack-install-failed",
    recoverable: true,
  });
});

test("native never starts recognition unless on-device English is available", async () => {
  const runtime = speechRuntime({ availability: "downloadable" });
  const provider = createNativeWebSpeechTranscriptionProvider({
    global: runtime.global,
  });

  await expect(provider.initialize(vi.fn())).rejects.toMatchObject({
    code: "language-pack-unavailable",
  });
  expect(runtime.instances).toHaveLength(1);
  expect(runtime.instances[0]?.start).not.toHaveBeenCalled();
});

test.each([
  ["native", false],
  ["online", true],
] as const)(
  "%s collects final results and configures capture",
  async (kind, expectedConsent) => {
    const runtime = speechRuntime({ prefixed: true });
    const provider =
      kind === "native"
        ? createNativeWebSpeechTranscriptionProvider({ global: runtime.global })
        : createOnlineWebSpeechTranscriptionProvider({
            global: runtime.global,
          });
    await provider.initialize(vi.fn());

    const operation = provider.transcribe(
      liveSpeech,
      new AbortController().signal,
    );
    const recognition = runtime.instances.at(-1)!;
    expect(recognition).toMatchObject({
      lang: "en-US",
      processLocally: kind === "native",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
    });
    recognition.result("  Thy word  ", " is truth ");
    recognition.end();

    await expect(operation).resolves.toMatchObject({
      text: "Thy word is truth",
    });
    expect(provider.requiresOnlineConsent).toBe(expectedConsent);
  },
);

test("online leaves processLocally unset when the implementation omits it", async () => {
  const runtime = speechRuntime({ processLocally: false });
  const provider = createOnlineWebSpeechTranscriptionProvider({
    global: runtime.global,
  });
  await provider.initialize(vi.fn());
  const operation = provider.transcribe(
    liveSpeech,
    new AbortController().signal,
  );
  const recognition = runtime.instances.at(-1)!;
  expect("processLocally" in recognition).toBe(false);
  recognition.result("Thy word");
  recognition.end();
  await operation;
});

test.each([
  ["not-allowed", "microphone-permission-denied"],
  ["service-not-allowed", "speech-service-unavailable"],
  ["no-speech", "no-speech"],
  ["network", "speech-service-unavailable"],
  ["audio-capture", "transcription-failed"],
] as const)("maps Web Speech %s to %s", async (speechError, code) => {
  const runtime = speechRuntime();
  const provider = createOnlineWebSpeechTranscriptionProvider({
    global: runtime.global,
  });
  await provider.initialize(vi.fn());
  const operation = provider.transcribe(
    liveSpeech,
    new AbortController().signal,
  );
  runtime.instances.at(-1)!.error(speechError);
  await expect(operation).rejects.toMatchObject({ code });
});

test("stop completes final collection, while cancellation aborts and suppresses late events", async () => {
  const runtime = speechRuntime();
  const provider = createOnlineWebSpeechTranscriptionProvider({
    global: runtime.global,
  });
  await provider.initialize(vi.fn());

  const stopped = provider.transcribe(liveSpeech, new AbortController().signal);
  const first = runtime.instances.at(-1)!;
  first.result("Thy word");
  provider.stop();
  expect(first.stop).toHaveBeenCalledOnce();
  first.end();
  await expect(stopped).resolves.toMatchObject({ text: "Thy word" });

  const controller = new AbortController();
  const cancelled = provider.transcribe(liveSpeech, controller.signal);
  const second = runtime.instances.at(-1)!;
  controller.abort();
  second.result("late result");
  second.end();
  await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
  expect(second.abort).toHaveBeenCalledOnce();
});

test("cleanup aborts active capture, removes handlers, and is idempotent", async () => {
  const runtime = speechRuntime();
  const provider = createNativeWebSpeechTranscriptionProvider({
    global: runtime.global,
  });
  await provider.initialize(vi.fn());
  const operation = provider.transcribe(
    liveSpeech,
    new AbortController().signal,
  );
  const recognition = runtime.instances.at(-1)!;

  await provider.cleanup();
  await provider.cleanup();

  await expect(operation).rejects.toMatchObject({ code: "cancelled" });
  expect(recognition.abort).toHaveBeenCalledOnce();
  expect(recognition.onresult).toBeNull();
  expect(recognition.onerror).toBeNull();
  expect(recognition.onend).toBeNull();
});

test("aborts live recognition at its capture duration limit", async () => {
  vi.useFakeTimers();
  const runtime = speechRuntime();
  const provider = createOnlineWebSpeechTranscriptionProvider({
    global: runtime.global,
    captureTimeoutMilliseconds: 10,
  });
  await provider.initialize(vi.fn());
  const operation = provider.transcribe(
    liveSpeech,
    new AbortController().signal,
  );
  const rejection = expect(operation).rejects.toMatchObject({
    code: "transcription-timeout",
  });

  await vi.advanceTimersByTimeAsync(10);

  await rejection;
  expect(runtime.instances.at(-1)!.abort).toHaveBeenCalledOnce();
  vi.useRealTimers();
});
