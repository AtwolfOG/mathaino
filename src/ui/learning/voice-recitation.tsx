"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { RecitationResult } from "../../application/recitation.ts";
import {
  TranscriptionManager,
  TranscriptionProviderError,
  validateRecordedAudioSize,
  type RecordedAudioInput,
  type TranscriptionInitializationUpdate,
  type TranscriptionProvider,
} from "../../application/transcription.ts";
import { createLocalWhisperBrowserProvider } from "../../infrastructure/transcription/local-whisper-browser.ts";
import {
  createMoonshineProvider,
  selectMoonshineVariant,
} from "../../infrastructure/transcription/moonshine.ts";
import {
  createNativeWebSpeechTranscriptionProvider,
  createOnlineWebSpeechTranscriptionProvider,
  type NativeSpeechAvailability,
  type NativeWebSpeechTranscriptionProvider,
} from "../../infrastructure/transcription/web-speech.ts";
import {
  errorMessage,
  isRecitationResult,
  RecitationFeedback,
  VerseReveal,
  type TypedRecitationProps,
} from "./typed-recitation.tsx";

export type SpeechRecognitionMode =
  | "automatic"
  | "moonshine-base"
  | "moonshine-tiny"
  | "native-web-speech"
  | "online-web-speech"
  | "local-whisper";

export interface VoiceProviderSet {
  providers: readonly TranscriptionProvider[];
  native: NativeWebSpeechTranscriptionProvider;
}

interface VoiceRecitationProps extends TypedRecitationProps {
  onTypeInstead: () => void;
  localWhisperEnabled?: boolean;
  createProviders?: () => VoiceProviderSet;
}

interface VoiceResponse extends RecitationResult {
  transcript: string;
}

type VoicePhase =
  | "idle"
  | "preparing"
  | "downloading"
  | "model-ready"
  | "recording"
  | "processing"
  | "transcript-ready"
  | "failed"
  | "alternative-available";

const candidateMediaTypes = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
];
const maxRecordingMilliseconds = 120_000;
const preferenceKey = "mathaino:speech-recognition-mode:v1";
const modes: readonly SpeechRecognitionMode[] = [
  "automatic",
  "moonshine-base",
  "moonshine-tiny",
  "native-web-speech",
  "online-web-speech",
  "local-whisper",
];

export function VoiceRecitation({
  itemId,
  reference,
  verseText,
  onTypeInstead,
  localWhisperEnabled = false,
  createProviders = defaultProviders,
}: VoiceRecitationProps) {
  const [providerSet] = useState(createProviders);
  const [manager] = useState(
    () => new TranscriptionManager(providerSet.providers),
  );
  const [mode, setMode] = useState<SpeechRecognitionMode>(readPreference);
  const [availableModes, setAvailableModes] = useState<SpeechRecognitionMode[]>(
    () =>
      recordedAudioSupportedModes(localWhisperEnabled, providerSet.providers),
  );
  const [nativeAvailability, setNativeAvailability] =
    useState<NativeSpeechAvailability>("unavailable");
  const [onlineConsent, setOnlineConsent] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [message, setMessage] = useState("");
  const [activeProvider, setActiveProvider] = useState("");
  const [progress, setProgress] = useState<number | undefined>();
  const [operationId, setOperationId] = useState(createOperationId);
  const [result, setResult] = useState<VoiceResponse | null>(null);
  const [uncertainTranscript, setUncertainTranscript] = useState<string | null>(
    null,
  );
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const operationRef = useRef<AbortController | null>(null);
  const retryPendingRef = useRef(false);
  const generationRef = useRef(0);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const cleanupRecording = useEffectEvent(() => stopRecorder(true));
  const validateSelectedMode = useEffectEvent(
    (capableModes: readonly SpeechRecognitionMode[]) => {
      if (!capableModes.includes(mode)) {
        setMode("automatic");
        writePreference("automatic");
      }
    },
  );

  useEffect(() => {
    let current = true;
    void (async () => {
      const next = recordedAudioSupportedModes(
        localWhisperEnabled,
        providerSet.providers,
      );
      try {
        const availability = await providerSet.native.getEnglishAvailability();
        if (!current) return;
        setNativeAvailability(availability);
        if (availability !== "unavailable") next.push("native-web-speech");
      } catch {
        // Capability probing must not prevent other modes from being used.
      }
      const online = providerSet.providers.find(
        (provider) => provider.id === "online-web-speech",
      );
      if (online) {
        try {
          const capability = await online.getCapability({
            inputKind: "live-speech",
            runtimeHints: {},
          });
          if (capability.supported) next.push("online-web-speech");
        } catch {
          // Capability probing must not mark a provider as attempted.
        }
      }
      if (current) {
        const capableModes = [...new Set(next)];
        setAvailableModes(capableModes);
        validateSelectedMode(capableModes);
        if (next.length === 1) {
          setPhase("alternative-available");
          setMessage("Voice recording is not supported by this browser.");
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [localWhisperEnabled, providerSet]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      operationRef.current?.abort();
      cleanupRecording();
      void manager.cleanup();
    },
    [manager],
  );

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  function releaseMicrophone() {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function stopRecorder(discard: boolean) {
    const recorder = recorderRef.current;
    if (recorder) {
      if (discard) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
      }
      if (recorder.state !== "inactive") recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    releaseMicrophone();
  }

  async function cancelCurrent() {
    generationRef.current += 1;
    operationRef.current?.abort();
    operationRef.current = null;
    stopRecorder(true);
    await manager.cancelActiveTranscription();
    await manager.cancelPendingInitialization();
  }

  async function changeMode(next: SpeechRecognitionMode) {
    await cancelCurrent();
    setMode(next);
    setOnlineConsent(false);
    setResult(null);
    setUncertainTranscript(null);
    setPhase("idle");
    setMessage("");
    setActiveProvider("");
    setProgress(undefined);
    writePreference(next);
  }

  function initializationUpdate(update: TranscriptionInitializationUpdate) {
    if (update.status === "progress") {
      setPhase("downloading");
      setProgress(update.progress);
      setMessage(update.message ?? "Downloading speech recognition model.");
    } else if (update.status === "ready") {
      setPhase("model-ready");
      setProgress(undefined);
      setMessage("Speech recognition model ready.");
    } else {
      setPhase("preparing");
      setMessage(update.message ?? "Preparing speech recognition.");
    }
  }

  async function initializeProvider(providerId: string, consent = false) {
    setPhase("preparing");
    setMessage("Preparing speech recognition.");
    setActiveProvider(
      providerSet.providers.find((provider) => provider.id === providerId)
        ?.label ?? "",
    );
    const inputKind = providerId.includes("web-speech")
      ? "live-speech"
      : "recorded-audio";
    await manager.initialize({
      providerId,
      inputKind,
      onlineConsent: consent,
      onUpdate: initializationUpdate,
    });
    const selected = manager.selectedProvider;
    setActiveProvider(selected?.label ?? "");
    return inputKind;
  }

  async function chooseAutomaticProvider() {
    const preferred = selectMoonshineVariant("auto", readDeviceMemory());
    const candidates =
      preferred === "base"
        ? ["moonshine-base", "moonshine-tiny", "native-web-speech"]
        : ["moonshine-tiny", "native-web-speech"];
    let lastError: unknown;
    for (const providerId of candidates) {
      if (
        !availableModes.includes(providerId as SpeechRecognitionMode) ||
        (providerId === "native-web-speech" &&
          nativeAvailability !== "available")
      )
        continue;
      try {
        return await initializeProvider(providerId);
      } catch (error) {
        lastError = error;
        if (
          providerId !== "native-web-speech" &&
          !isRecoverableAutomaticFailure(error)
        )
          throw error;
      }
    }
    throw new AlternativeAvailableError(
      availableModes.includes("online-web-speech")
        ? "Offline speech recognition is unavailable. Online recognition requires your explicit consent, or you can type instead."
        : "Speech recognition is unavailable. You can type your recitation instead.",
      { cause: lastError },
    );
  }

  async function start() {
    if (phase === "preparing" || phase === "downloading") return;
    setResult(null);
    setMessage("");
    const generation = ++generationRef.current;
    const controller = new AbortController();
    operationRef.current?.abort();
    operationRef.current = controller;
    try {
      const inputKind =
        mode === "automatic"
          ? await chooseAutomaticProvider()
          : await initializeProvider(mode, onlineConsent);
      if (generation !== generationRef.current) return;
      if (inputKind === "live-speech") {
        setPhase("recording");
        setMessage("Listening for your recitation.");
        const transcription = await manager.transcribe(
          { kind: "live-speech" },
          controller.signal,
        );
        if (generation !== generationRef.current) return;
        await submitTranscript(transcription.text, generation, controller);
      } else {
        await startMediaRecorder(generation);
      }
    } catch (error) {
      handleFailure(error, generation);
    }
  }

  async function startMediaRecorder(generation: number) {
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    )
      throw new Error("Voice recording is not supported by this browser.");
    const mediaType = candidateMediaTypes.find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mediaType)
      throw new Error(
        "This browser does not provide a supported audio format.",
      );
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      throw new Error(microphoneError(error));
    }
    if (generation !== generationRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    try {
      const recorder = new MediaRecorder(stream, { mimeType: mediaType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        stopRecorder(true);
        handleFailure(new Error("Recording failed."), generation);
      };
      recorder.onstop = () => void finishRecording(mediaType, generation);
      startedAtRef.current = performance.now();
      recorder.start();
    } catch (error) {
      stopRecorder(true);
      throw error;
    }
    setPhase("recording");
    setMessage("Recording your recitation.");
    stopTimerRef.current = setTimeout(stop, maxRecordingMilliseconds);
  }

  function stop() {
    if (manager.selectedProvider?.id.includes("web-speech")) {
      setPhase("processing");
      setMessage("Finishing speech recognition.");
      manager.stopActiveTranscription();
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setPhase("processing");
    setMessage("Processing your recording.");
    recorder.stop();
  }

  async function finishRecording(mediaType: string, generation: number) {
    const durationSeconds = Math.min(
      120,
      (performance.now() - startedAtRef.current) / 1_000,
    );
    const audio = new Blob(chunksRef.current, { type: mediaType });
    chunksRef.current = [];
    recorderRef.current = null;
    releaseMicrophone();
    if (generation !== generationRef.current) return;
    if (audio.size === 0 || durationSeconds < 0.25) {
      handleFailure(
        new Error("No usable audio was recorded. Speak clearly and try again."),
        generation,
      );
      return;
    }
    try {
      validateRecordedAudioSize(audio.size);
    } catch (error) {
      handleFailure(error, generation);
      return;
    }
    const input: RecordedAudioInput = {
      kind: "recorded-audio",
      bytes: new Uint8Array(await audio.arrayBuffer()),
      mediaType,
      durationSeconds,
    };
    setPhase("processing");
    setMessage("Transcribing your recitation.");
    try {
      const transcript = await transcribeRecorded(input, generation);
      if (generation !== generationRef.current) return;
      await submitTranscript(
        transcript,
        generation,
        operationRef.current ?? new AbortController(),
      );
    } catch (error) {
      handleFailure(error, generation);
    }
  }

  async function transcribeRecorded(
    input: RecordedAudioInput,
    generation: number,
  ) {
    const signal = operationRef.current?.signal ?? new AbortController().signal;
    try {
      return (await manager.transcribe(input, signal)).text;
    } catch (error) {
      if (mode !== "automatic" || generation !== generationRef.current)
        throw error;
      if (!isRecoverableAutomaticFailure(error)) throw error;
      if (manager.selectedProvider?.id === "moonshine-base") {
        try {
          await initializeProvider("moonshine-tiny");
          if (generation !== generationRef.current)
            throw new DOMException("Cancelled", "AbortError");
          return (await manager.transcribe(input, signal)).text;
        } catch (fallbackError) {
          throw automaticAlternative(fallbackError, availableModes);
        }
      }
      throw automaticAlternative(error, availableModes);
    }
  }

  async function submitTranscript(
    transcript: string,
    generation: number,
    controller: AbortController,
  ) {
    setPhase("transcript-ready");
    setMessage("Transcript ready. Checking your recitation.");
    let response: Response;
    let value: unknown;
    try {
      response = await fetch("/api/voice-recitation-attempts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, operationId, text: transcript }),
        signal: controller.signal,
      });
      value = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      setUncertainTranscript(transcript);
      setPhase("failed");
      setMessage(
        "The save outcome could not be confirmed. Try saving the same transcript again.",
      );
      return;
    }
    if (generation !== generationRef.current) return;
    if (response.ok && isRecitationResult(value)) {
      setResult({ ...value, transcript });
      setUncertainTranscript(null);
      setMessage("Transcript ready and recitation checked.");
      return;
    }
    if (response.status === 503) {
      setUncertainTranscript(transcript);
      setPhase("failed");
      setMessage(
        "The save outcome could not be confirmed. Try saving the same transcript again.",
      );
      return;
    }
    setUncertainTranscript(null);
    throw new Error(
      errorMessage(value) ??
        "Voice recitation could not be checked. Try again.",
    );
  }

  async function retryUncertainSave() {
    if (!uncertainTranscript || retryPendingRef.current) return;
    retryPendingRef.current = true;
    const transcript = uncertainTranscript;
    const generation = generationRef.current;
    const controller = new AbortController();
    operationRef.current = controller;
    try {
      await submitTranscript(transcript, generation, controller);
    } catch (error) {
      if (generation === generationRef.current && !isCancellation(error))
        setUncertainTranscript(transcript);
      handleFailure(error, generation);
    } finally {
      retryPendingRef.current = false;
    }
  }

  function handleFailure(error: unknown, generation: number) {
    if (generation !== generationRef.current || isCancellation(error)) return;
    setPhase(
      error instanceof AlternativeAvailableError
        ? "alternative-available"
        : "failed",
    );
    setMessage(providerErrorMessage(error));
  }

  async function installNativeEnglish() {
    setPhase("preparing");
    setMessage("Installing the on-device English language pack.");
    try {
      const installed = await providerSet.native.installEnglishLanguagePack();
      const availability = await providerSet.native.getEnglishAvailability();
      setNativeAvailability(availability);
      if (installed && availability === "available") {
        setPhase("model-ready");
        setMessage("On-device English language pack ready.");
      } else {
        throw new Error("The on-device English language pack is not ready.");
      }
    } catch (error) {
      setPhase("failed");
      setMessage(providerErrorMessage(error));
    }
  }

  async function refreshNativeEnglish() {
    setPhase("preparing");
    setMessage("Checking the on-device English language pack.");
    try {
      const availability = await providerSet.native.getEnglishAvailability();
      setNativeAvailability(availability);
      if (availability === "available") {
        setPhase("model-ready");
        setMessage("On-device English language pack ready.");
      } else {
        setPhase("idle");
        setMessage("The on-device English language pack is still downloading.");
      }
    } catch (error) {
      setPhase("failed");
      setMessage(providerErrorMessage(error));
    }
  }

  function retry() {
    generationRef.current += 1;
    operationRef.current?.abort();
    operationRef.current = null;
    setResult(null);
    setUncertainTranscript(null);
    setOperationId(createOperationId());
    setPhase("idle");
    setMessage("");
  }

  const busy =
    phase === "preparing" ||
    phase === "downloading" ||
    phase === "processing" ||
    phase === "transcript-ready";
  const selectedModeAvailable =
    mode === "automatic" || availableModes.includes(mode);

  return (
    <div className="voice-recitation">
      <VerseReveal itemId={itemId} verseText={verseText} />
      <p>
        Speak {reference}. Local modes keep audio on this device; Local Whisper
        sends audio only to the development server.
      </p>
      <div className="speech-mode-field">
        <label htmlFor={`speech-mode-${itemId}`}>Speech recognition mode</label>
        <select
          id={`speech-mode-${itemId}`}
          value={mode}
          onChange={(event) =>
            void changeMode(event.target.value as SpeechRecognitionMode)
          }
        >
          <option value="automatic">Automatic</option>
          {availableModes.includes("moonshine-base") ? (
            <option value="moonshine-base">Moonshine Base</option>
          ) : null}
          {availableModes.includes("moonshine-tiny") ? (
            <option value="moonshine-tiny">Moonshine Tiny</option>
          ) : null}
          {availableModes.includes("native-web-speech") ? (
            <option value="native-web-speech">On-device browser speech</option>
          ) : null}
          {availableModes.includes("online-web-speech") ? (
            <option value="online-web-speech">Online browser speech</option>
          ) : null}
          {availableModes.includes("local-whisper") ? (
            <option value="local-whisper">Local Whisper (development)</option>
          ) : null}
        </select>
      </div>
      {mode === "native-web-speech" && nativeAvailability === "downloadable" ? (
        <button type="button" onClick={() => void installNativeEnglish()}>
          Install on-device English language pack
        </button>
      ) : null}
      {mode === "native-web-speech" && nativeAvailability === "downloading" ? (
        <button type="button" onClick={() => void refreshNativeEnglish()}>
          Check on-device English language pack
        </button>
      ) : null}
      {mode === "online-web-speech" && !onlineConsent ? (
        <div className="online-speech-consent">
          <p>
            Online browser speech recognition may send audio to your browser
            vendor for processing. Consent applies only to this selection.
          </p>
          <button type="button" onClick={() => setOnlineConsent(true)}>
            Allow online recognition
          </button>
        </div>
      ) : null}
      {phase === "recording" ? (
        <button type="button" onClick={stop}>
          Stop recording
        </button>
      ) : uncertainTranscript ? (
        <button
          type="button"
          onClick={() => void retryUncertainSave()}
          disabled={busy}
        >
          Try saving again
        </button>
      ) : result === null ? (
        <button
          type="button"
          onClick={() => void start()}
          disabled={
            busy ||
            !selectedModeAvailable ||
            (mode === "online-web-speech" && !onlineConsent) ||
            (mode === "native-web-speech" && nativeAvailability !== "available")
          }
        >
          {phase === "preparing"
            ? "Preparing…"
            : phase === "downloading"
              ? "Downloading…"
              : "Start recording"}
        </button>
      ) : null}
      <button type="button" onClick={onTypeInstead}>
        Type instead
      </button>
      <div className="voice-status" role="status" aria-live="polite">
        {activeProvider ? <p>Active provider: {activeProvider}</p> : null}
        {progress !== undefined ? (
          <progress
            value={progress}
            max={1}
            aria-label="Model download progress"
          />
        ) : null}
        {message ? <p>{message}</p> : null}
      </div>
      {phase === "failed" || phase === "alternative-available" ? (
        <p role="alert">{message}</p>
      ) : null}
      {result ? (
        <>
          <section aria-labelledby={`transcript-${itemId}`}>
            <h3 id={`transcript-${itemId}`}>Transcript</h3>
            <p>{result.transcript}</p>
          </section>
          <RecitationFeedback
            result={result}
            headingRef={resultRef}
            onRetry={retry}
            substitutionVerb="heard"
          />
        </>
      ) : null}
    </div>
  );
}

function defaultProviders(): VoiceProviderSet {
  const native = createNativeWebSpeechTranscriptionProvider();
  return {
    native,
    providers: [
      createMoonshineProvider({ variant: "base" }),
      createMoonshineProvider({ variant: "tiny" }),
      native,
      createOnlineWebSpeechTranscriptionProvider(),
      createLocalWhisperBrowserProvider(),
    ],
  };
}

function recordedAudioSupportedModes(
  localWhisperEnabled: boolean,
  providers: readonly TranscriptionProvider[],
) {
  const next: SpeechRecognitionMode[] = ["automatic"];
  if (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    candidateMediaTypes.some((type) => MediaRecorder.isTypeSupported(type))
  ) {
    next.push("moonshine-base", "moonshine-tiny");
    if (
      localWhisperEnabled &&
      providers.some((provider) => provider.id === "local-whisper")
    )
      next.push("local-whisper");
  }
  return next;
}

function readPreference(): SpeechRecognitionMode {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(preferenceKey) ?? "",
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      parsed.version === 1 &&
      "mode" in parsed &&
      modes.includes(parsed.mode as SpeechRecognitionMode)
    )
      return parsed.mode as SpeechRecognitionMode;
  } catch {
    // Storage can be blocked or contain stale data.
  }
  return "automatic";
}

function writePreference(mode: SpeechRecognitionMode) {
  try {
    localStorage.setItem(preferenceKey, JSON.stringify({ version: 1, mode }));
  } catch {
    // Recognition remains usable when storage is unavailable.
  }
}

function readDeviceMemory() {
  if (typeof navigator === "undefined") return undefined;
  const value = (navigator as Navigator & { deviceMemory?: unknown })
    .deviceMemory;
  return typeof value === "number" ? value : undefined;
}

function providerErrorMessage(error: unknown) {
  if (error instanceof TranscriptionProviderError || error instanceof Error)
    return error.message;
  return "Speech recognition failed. Try another mode or type your recitation.";
}

class AlternativeAvailableError extends Error {}

function automaticAlternative(
  cause: unknown,
  availableModes: readonly SpeechRecognitionMode[],
) {
  return new AlternativeAvailableError(
    availableModes.includes("native-web-speech") ||
      availableModes.includes("online-web-speech")
      ? "This local transcription failed. Choose an available browser speech mode explicitly, or type your recitation."
      : "Speech recognition failed. You can type your recitation instead.",
    { cause },
  );
}

function isCancellation(error: unknown) {
  return (
    (error instanceof TranscriptionProviderError &&
      error.code === "cancelled") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function isRecoverableAutomaticFailure(error: unknown) {
  return (
    error instanceof TranscriptionProviderError &&
    error.recoverable &&
    [
      "provider-unsupported",
      "initialization-failed",
      "model-files-unavailable",
      "storage-failed",
      "model-failed",
      "memory-exhausted",
      "transcription-failed",
    ].includes(error.code)
  );
}

function createOperationId() {
  return crypto.randomUUID();
}

function microphoneError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "Microphone access was denied. Allow access or type your recitation.";
  if (error instanceof DOMException && error.name === "NotFoundError")
    return "No microphone was found. Connect one or type your recitation.";
  return "The microphone could not be started. Try again or type your recitation.";
}
