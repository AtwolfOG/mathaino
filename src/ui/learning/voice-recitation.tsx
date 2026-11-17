"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { RecitationResult } from "../../application/recitation.ts";
import {
  audioRecorderReducer,
  initialAudioRecorderState,
} from "./audio-recorder.ts";
import {
  errorMessage,
  isRecitationResult,
  RecitationFeedback,
  VerseReveal,
  type TypedRecitationProps,
} from "./typed-recitation.tsx";

interface VoiceRecitationProps extends TypedRecitationProps {
  onTypeInstead: () => void;
}

interface VoiceResponse extends RecitationResult {
  transcript: string;
}

const candidateMediaTypes = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
];
const maxRecordingMilliseconds = 120_000;

export function VoiceRecitation({
  itemId,
  reference,
  verseText,
  onTypeInstead,
}: VoiceRecitationProps) {
  const [state, dispatch] = useReducer(
    audioRecorderReducer,
    initialAudioRecorderState,
  );
  const [operationId, setOperationId] = useState(createOperationId);
  const [result, setResult] = useState<VoiceResponse | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    )
      dispatch({
        type: "unsupported",
        message: "Voice recording is not supported by this browser.",
      });
    else if (
      !candidateMediaTypes.some((type) => MediaRecorder.isTypeSupported(type))
    )
      dispatch({
        type: "unsupported",
        message: "This browser does not provide a supported audio format.",
      });
  }, []);
  useEffect(
    () => () => {
      discardRecordingRef.current = true;
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      releaseMicrophone();
    },
    [],
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

  async function startRecording() {
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      dispatch({
        type: "unsupported",
        message: "Voice recording is not supported by this browser.",
      });
      return;
    }
    const mediaType = candidateMediaTypes.find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mediaType) {
      dispatch({
        type: "unsupported",
        message: "This browser does not provide a supported audio format.",
      });
      return;
    }
    if (state.status === "error") dispatch({ type: "retry" });
    dispatch({ type: "request" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      discardRecordingRef.current = false;
      const recorder = new MediaRecorder(stream, { mimeType: mediaType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        discardRecordingRef.current = true;
        if (recorder.state !== "inactive") recorder.stop();
        releaseMicrophone();
        dispatch({
          type: "fail",
          message: "Recording failed. Try again or type your recitation.",
        });
      };
      recorder.onstop = () =>
        void finishRecording(recorder.mimeType || mediaType);
      startedAtRef.current = performance.now();
      recorder.start();
      dispatch({ type: "start" });
      stopTimerRef.current = setTimeout(
        stopRecording,
        maxRecordingMilliseconds,
      );
    } catch (error) {
      releaseMicrophone();
      dispatch({ type: "fail", message: microphoneError(error) });
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    dispatch({ type: "stop" });
    recorder.stop();
  }

  async function finishRecording(mediaType: string) {
    const durationSeconds = Math.min(
      120,
      (performance.now() - startedAtRef.current) / 1_000,
    );
    releaseMicrophone();
    if (discardRecordingRef.current) {
      chunksRef.current = [];
      dispatch({ type: "cancel" });
      return;
    }
    const audio = new Blob(chunksRef.current, { type: mediaType });
    chunksRef.current = [];
    if (audio.size === 0 || durationSeconds < 0.25) {
      dispatch({
        type: "fail",
        message: "No usable audio was recorded. Speak clearly and try again.",
      });
      return;
    }
    dispatch({ type: "upload" });
    const body = new FormData();
    body.set("itemId", itemId);
    body.set("operationId", operationId);
    body.set("durationSeconds", String(durationSeconds));
    body.set("audio", audio, "recitation");
    try {
      const response = await fetch("/api/voice-recitation-attempts", {
        method: "POST",
        body,
      });
      const value: unknown = await response.json();
      if (response.ok && isVoiceResponse(value)) {
        setResult(value);
        dispatch({ type: "complete" });
      } else {
        dispatch({
          type: "fail",
          message:
            errorMessage(value) ??
            "Voice recitation could not be checked. Try again.",
        });
      }
    } catch {
      dispatch({
        type: "fail",
        message: "Network error. Check your connection and try again.",
      });
    }
  }

  function retry() {
    setResult(null);
    setOperationId(createOperationId());
    dispatch({ type: "retry" });
  }

  return (
    <div className="voice-recitation">
      <VerseReveal itemId={itemId} verseText={verseText} />
      <p>Speak {reference}. Your recording is sent only for transcription.</p>
      {state.status === "recording" ? (
        <button type="button" onClick={stopRecording}>
          Stop recording
        </button>
      ) : result === null ? (
        <button
          type="button"
          onClick={startRecording}
          disabled={
            state.status === "unsupported" ||
            state.status === "requesting" ||
            state.status === "stopping" ||
            state.status === "uploading"
          }
        >
          {state.status === "requesting"
            ? "Waiting for microphone…"
            : state.status === "stopping"
              ? "Preparing recording…"
              : state.status === "uploading"
                ? "Transcribing and checking…"
                : "Start recording"}
        </button>
      ) : null}
      <button type="button" onClick={onTypeInstead}>
        Type instead
      </button>
      {state.message ? <p role="alert">{state.message}</p> : null}
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
          />
        </>
      ) : null}
    </div>
  );
}

function microphoneError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "Microphone access was denied. Allow access or type your recitation.";
  if (error instanceof DOMException && error.name === "NotFoundError")
    return "No microphone was found. Connect one or type your recitation.";
  return "The microphone could not be started. Try again or type your recitation.";
}

function createOperationId() {
  return crypto.randomUUID();
}

function isVoiceResponse(value: unknown): value is VoiceResponse {
  return (
    isRecitationResult(value) &&
    "transcript" in value &&
    typeof value.transcript === "string"
  );
}
