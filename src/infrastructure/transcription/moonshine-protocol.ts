import type { TranscriptionInitializationUpdate } from "../../application/transcription.ts";

export type MoonshineWorkerErrorCode =
  | "download-failed"
  | "storage-failed"
  | "model-failed"
  | "memory-exhausted"
  | "inference-failed";

export interface MoonshineModelConfig {
  id: string;
  revision: string;
}

export type MoonshineRuntimeConfig =
  { device: "webgpu"; dtype: "q4" } | { device: "wasm"; dtype: "q8" };

export type MoonshineMainMessage =
  | {
      type: "initialize";
      model: MoonshineModelConfig;
      environment: { useBrowserCache: true; allowLocalModels: false };
      runtime: MoonshineRuntimeConfig;
    }
  | {
      type: "transcribe";
      samples: Float32Array;
      sampleRate: 16_000;
    }
  | { type: "dispose" };

export type ParsedWorkerMessage =
  | { type: "ready" }
  | { type: "progress"; update: TranscriptionInitializationUpdate }
  | { type: "result"; text: string }
  | { type: "error"; code: MoonshineWorkerErrorCode; message: string };

const workerErrorCodes = new Set<MoonshineWorkerErrorCode>([
  "download-failed",
  "storage-failed",
  "model-failed",
  "memory-exhausted",
  "inference-failed",
]);

export function parseWorkerMessage(
  value: unknown,
): ParsedWorkerMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  if (value.type === "ready") return { type: "ready" };
  if (value.type === "result" && typeof value.text === "string") {
    return { type: "result", text: value.text };
  }
  if (
    value.type === "error" &&
    typeof value.code === "string" &&
    workerErrorCodes.has(value.code as MoonshineWorkerErrorCode) &&
    typeof value.message === "string"
  ) {
    return {
      type: "error",
      code: value.code as MoonshineWorkerErrorCode,
      message: value.message,
    };
  }
  if (value.type === "progress") {
    const progress = value.progress;
    const message = value.message;
    if (
      (progress === undefined ||
        (typeof progress === "number" &&
          Number.isFinite(progress) &&
          progress >= 0 &&
          progress <= 1)) &&
      (message === undefined || typeof message === "string")
    ) {
      return {
        type: "progress",
        update: { status: "progress", progress, message },
      };
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
