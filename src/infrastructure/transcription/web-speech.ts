import {
  TranscriptionProviderError,
  type TranscriptionCapabilityRequest,
  type TranscriptionErrorCode,
  type TranscriptionInitializationUpdate,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "../../application/transcription.ts";

export type NativeSpeechAvailability =
  "available" | "downloading" | "downloadable" | "unavailable";

interface SpeechRecognitionResultAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultAlternativeLike | undefined;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike | undefined;
}

interface SpeechRecognitionResultEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface OnDeviceSpeechOptions {
  langs: ["en-US"];
  processLocally: true;
  quality: "dictation";
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
  available?(options: OnDeviceSpeechOptions): Promise<NativeSpeechAvailability>;
  install?(options: OnDeviceSpeechOptions): Promise<boolean>;
}

interface WebSpeechGlobalLike {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
}

export interface WebSpeechProviderOptions {
  global?: WebSpeechGlobalLike;
  captureTimeoutMilliseconds?: number;
}

export interface OnlineWebSpeechTranscriptionProvider extends TranscriptionProvider {
  stop(): void;
}

export interface NativeWebSpeechTranscriptionProvider extends OnlineWebSpeechTranscriptionProvider {
  getEnglishAvailability(): Promise<NativeSpeechAvailability>;
  installEnglishLanguagePack(): Promise<boolean>;
}

const ENGLISH_DICTATION_OPTIONS: OnDeviceSpeechOptions = {
  langs: ["en-US"],
  processLocally: true,
  quality: "dictation",
};

export function createNativeWebSpeechTranscriptionProvider(
  options: WebSpeechProviderOptions = {},
): NativeWebSpeechTranscriptionProvider {
  const global = options.global ?? browserGlobal();
  const constructor = getConstructor(global);
  const getOnDeviceConstructor = () => {
    if (
      !constructor ||
      typeof constructor.available !== "function" ||
      typeof constructor.install !== "function"
    ) {
      return undefined;
    }
    try {
      return "processLocally" in new constructor() ? constructor : undefined;
    } catch {
      return undefined;
    }
  };
  const getEnglishAvailability =
    async (): Promise<NativeSpeechAvailability> => {
      const onDeviceConstructor = getOnDeviceConstructor();
      if (!onDeviceConstructor) return "unavailable";
      const availability = await onDeviceConstructor.available!(
        ENGLISH_DICTATION_OPTIONS,
      );
      return isNativeSpeechAvailability(availability)
        ? availability
        : "unavailable";
    };
  const shared = createWebSpeechProvider({
    id: "native-web-speech",
    label: "On-device browser speech recognition",
    requiresOnlineConsent: false,
    constructor,
    processLocally: true,
    getAdditionalCapability: async () => {
      if (!getOnDeviceConstructor()) {
        return unsupported(
          "This browser does not support on-device speech recognition.",
        );
      }
      const availability = await getEnglishAvailability();
      return availability === "available"
        ? { supported: true }
        : unsupported(availabilityReason(availability));
    },
    beforeInitialize: async () => {
      const availability = await getEnglishAvailability();
      if (availability !== "available") {
        throw providerError(
          "language-pack-unavailable",
          availabilityReason(availability),
          "native-web-speech",
        );
      }
    },
    captureTimeoutMilliseconds: options.captureTimeoutMilliseconds,
  });

  return {
    ...shared,
    getEnglishAvailability,
    async installEnglishLanguagePack() {
      const onDeviceConstructor = getOnDeviceConstructor();
      if (!onDeviceConstructor) {
        throw providerError(
          "language-pack-install-failed",
          "This browser cannot install an on-device English language pack.",
          shared.id,
        );
      }
      try {
        return await onDeviceConstructor.install!(ENGLISH_DICTATION_OPTIONS);
      } catch (cause) {
        throw providerError(
          "language-pack-install-failed",
          "The on-device English language pack could not be installed.",
          shared.id,
          cause,
        );
      }
    },
  };
}

export function createOnlineWebSpeechTranscriptionProvider(
  options: WebSpeechProviderOptions = {},
): OnlineWebSpeechTranscriptionProvider {
  const constructor = getConstructor(options.global ?? browserGlobal());
  return createWebSpeechProvider({
    id: "online-web-speech",
    label: "Online browser speech recognition",
    requiresOnlineConsent: true,
    constructor,
    processLocally: false,
    captureTimeoutMilliseconds: options.captureTimeoutMilliseconds,
  });
}

interface SharedProviderOptions {
  id: string;
  label: string;
  requiresOnlineConsent: boolean;
  constructor?: SpeechRecognitionConstructorLike;
  processLocally: boolean;
  getAdditionalCapability?: () =>
    | ReturnType<typeof unsupported>
    | { supported: true }
    | Promise<ReturnType<typeof unsupported> | { supported: true }>;
  beforeInitialize?: () => Promise<void>;
  captureTimeoutMilliseconds?: number;
}

function createWebSpeechProvider(
  options: SharedProviderOptions,
): OnlineWebSpeechTranscriptionProvider {
  let initialized = false;
  let active:
    | {
        recognition: SpeechRecognitionLike;
        cancel: () => void;
      }
    | undefined;

  return {
    id: options.id,
    label: options.label,
    requiresOnlineConsent: options.requiresOnlineConsent,
    async getCapability(request: TranscriptionCapabilityRequest) {
      if (request.inputKind !== "live-speech") {
        return unsupported("Web Speech supports live speech input only.");
      }
      if (!options.constructor) {
        return unsupported("This browser does not support Web Speech.");
      }
      return options.getAdditionalCapability?.() ?? { supported: true };
    },
    async initialize(
      onUpdate: (update: TranscriptionInitializationUpdate) => void,
    ) {
      if (!options.constructor) {
        throw providerError(
          "provider-unsupported",
          "This browser does not support Web Speech.",
          options.id,
        );
      }
      await options.beforeInitialize?.();
      initialized = true;
      onUpdate({ status: "ready" });
    },
    transcribe(input, signal) {
      if (!initialized) {
        return Promise.reject(
          providerError(
            "not-initialized",
            "Initialize Web Speech before transcribing.",
            options.id,
          ),
        );
      }
      if (input.kind !== "live-speech") {
        return Promise.reject(
          providerError(
            "input-kind-mismatch",
            "Web Speech supports live speech input only.",
            options.id,
          ),
        );
      }
      if (active) {
        return Promise.reject(
          providerError(
            "provider-busy",
            "Speech recognition is already active.",
            options.id,
          ),
        );
      }
      return captureSpeech(
        options.constructor!,
        signal,
        options,
        (operation) => {
          active = operation;
        },
        () => {
          active = undefined;
        },
      );
    },
    stop() {
      active?.recognition.stop();
    },
    async cleanup() {
      const operation = active;
      initialized = false;
      operation?.cancel();
    },
  };
}

function captureSpeech(
  constructor: SpeechRecognitionConstructorLike,
  signal: AbortSignal,
  options: SharedProviderOptions,
  setActive: (active: {
    recognition: SpeechRecognitionLike;
    cancel: () => void;
  }) => void,
  clearActive: () => void,
): Promise<TranscriptionResult> {
  const recognition = new constructor();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  if (options.processLocally || "processLocally" in recognition) {
    recognition.processLocally = options.processLocally;
  }

  return new Promise((resolve, reject) => {
    const finalTranscripts: string[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      recognition.abort();
      fail(
        providerError(
          "transcription-timeout",
          "Speech recognition timed out.",
          options.id,
        ),
      );
    }, options.captureTimeoutMilliseconds ?? 120_000);
    const detach = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      clearActive();
    };
    const fail = (error: TranscriptionProviderError) => {
      if (settled) return;
      settled = true;
      detach();
      reject(error);
    };
    const cancel = () => {
      if (settled) return;
      recognition.abort();
      fail(
        providerError(
          "cancelled",
          "Speech recognition was cancelled.",
          options.id,
        ),
      );
    };
    recognition.onresult = (event) => {
      if (settled) return;
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index++
      ) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript;
        if (result?.isFinal && typeof transcript === "string") {
          finalTranscripts.push(transcript);
        }
      }
    };
    recognition.onerror = (event) => {
      fail(mapSpeechError(event.error, options.id));
    };
    recognition.onend = () => {
      if (settled) return;
      const text = normalizeTranscript(finalTranscripts.join(" "));
      if (!text) {
        fail(
          providerError("no-speech", "No speech was recognized.", options.id),
        );
        return;
      }
      settled = true;
      detach();
      resolve({
        text,
        provider: { id: options.id, label: options.label },
      });
    };
    setActive({ recognition, cancel });
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    try {
      recognition.start();
    } catch (cause) {
      fail(
        providerError(
          "transcription-failed",
          "Speech recognition could not start.",
          options.id,
          cause,
        ),
      );
    }
  });
}

function mapSpeechError(
  speechError: string,
  providerId: string,
): TranscriptionProviderError {
  if (speechError === "not-allowed") {
    return providerError(
      "microphone-permission-denied",
      "Microphone permission was denied.",
      providerId,
    );
  }
  if (speechError === "no-speech") {
    return providerError("no-speech", "No speech was recognized.", providerId);
  }
  if (speechError === "network" || speechError === "service-not-allowed") {
    return providerError(
      "speech-service-unavailable",
      "The online speech recognition service is unavailable.",
      providerId,
    );
  }
  return providerError(
    "transcription-failed",
    "Speech recognition failed.",
    providerId,
  );
}

function getConstructor(
  global: WebSpeechGlobalLike,
): SpeechRecognitionConstructorLike | undefined {
  return global.SpeechRecognition ?? global.webkitSpeechRecognition;
}

function browserGlobal(): WebSpeechGlobalLike {
  return typeof globalThis === "object"
    ? (globalThis as WebSpeechGlobalLike)
    : {};
}

function unsupported(reason: string) {
  return { supported: false as const, reason };
}

function availabilityReason(availability: NativeSpeechAvailability): string {
  if (availability === "downloading") {
    return "The on-device English language pack is downloading.";
  }
  if (availability === "downloadable") {
    return "The on-device English language pack must be installed.";
  }
  return "On-device English dictation is unavailable.";
}

function isNativeSpeechAvailability(
  value: unknown,
): value is NativeSpeechAvailability {
  return (
    value === "available" ||
    value === "downloading" ||
    value === "downloadable" ||
    value === "unavailable"
  );
}

function normalizeTranscript(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function providerError(
  code: TranscriptionErrorCode,
  message: string,
  providerId: string,
  cause?: unknown,
) {
  return new TranscriptionProviderError({
    code,
    message,
    recoverable: true,
    providerId,
    cause,
  });
}
