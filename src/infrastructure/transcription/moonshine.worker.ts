import type {
  MoonshineMainMessage,
  MoonshineWorkerErrorCode,
} from "./moonshine-protocol.ts";

interface SpeechRecognitionPipeline {
  (audio: Float32Array): Promise<unknown>;
  dispose(): Promise<void>;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

const scope = self as unknown as WorkerScope;
let recognizer: SpeechRecognitionPipeline | undefined;

scope.onmessage = (event) => {
  void handleMessage(event.data);
};

async function handleMessage(value: unknown): Promise<void> {
  const message = parseMainMessage(value);
  if (!message) {
    postError("model-failed", "The worker received an invalid request.");
    return;
  }
  if (message.type === "initialize") {
    if (recognizer) {
      scope.postMessage({ type: "ready" });
      return;
    }
    try {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.useBrowserCache = message.environment.useBrowserCache;
      env.allowLocalModels = message.environment.allowLocalModels;
      recognizer = await pipeline(
        "automatic-speech-recognition",
        message.model.id,
        {
          revision: message.model.revision,
          device: message.runtime.device,
          dtype: message.runtime.dtype,
          progress_callback: (update) => {
            const progress = readProgress(update);
            scope.postMessage({
              type: "progress",
              progress,
              message: readProgressMessage(update),
            });
          },
        },
      );
      scope.postMessage({ type: "ready" });
    } catch (error) {
      postError(
        classifyInitializationError(error),
        initializationMessage(error),
      );
    }
    return;
  }
  if (message.type === "transcribe") {
    if (!recognizer) {
      postError("model-failed", "The model has not been initialized.");
      return;
    }
    try {
      const result: unknown = await recognizer(message.samples);
      if (!isRecord(result) || typeof result.text !== "string") {
        postError("inference-failed", "The model returned an invalid result.");
        return;
      }
      scope.postMessage({ type: "result", text: result.text });
    } catch (error) {
      postError(
        isMemoryError(error) ? "memory-exhausted" : "inference-failed",
        isMemoryError(error)
          ? "There is not enough memory to run this model."
          : "The model could not transcribe the audio.",
      );
    }
    return;
  }
  await recognizer?.dispose();
  recognizer = undefined;
  scope.close();
}

function parseMainMessage(value: unknown): MoonshineMainMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  if (value.type === "dispose") return { type: "dispose" };
  if (
    value.type === "transcribe" &&
    value.samples instanceof Float32Array &&
    value.sampleRate === 16_000
  ) {
    return { type: "transcribe", samples: value.samples, sampleRate: 16_000 };
  }
  if (
    value.type === "initialize" &&
    isRecord(value.model) &&
    typeof value.model.id === "string" &&
    typeof value.model.revision === "string" &&
    isRecord(value.environment) &&
    value.environment.useBrowserCache === true &&
    value.environment.allowLocalModels === false &&
    isRecord(value.runtime) &&
    ((value.runtime.device === "webgpu" && value.runtime.dtype === "q4") ||
      (value.runtime.device === "wasm" && value.runtime.dtype === "q8"))
  ) {
    return {
      type: "initialize",
      model: { id: value.model.id, revision: value.model.revision },
      environment: { useBrowserCache: true, allowLocalModels: false },
      runtime:
        value.runtime.device === "webgpu"
          ? { device: "webgpu", dtype: "q4" }
          : { device: "wasm", dtype: "q8" },
    };
  }
  return undefined;
}

function classifyInitializationError(error: unknown): MoonshineWorkerErrorCode {
  if (isMemoryError(error)) return "memory-exhausted";
  if (
    error instanceof DOMException &&
    ["QuotaExceededError", "UnknownError"].includes(error.name)
  ) {
    return "storage-failed";
  }
  const message = errorMessage(error);
  if (/fetch|network|download|404|403|failed to load/i.test(message)) {
    return "download-failed";
  }
  return "model-failed";
}

function initializationMessage(error: unknown): string {
  const code = classifyInitializationError(error);
  if (code === "memory-exhausted") {
    return "There is not enough memory to load this model.";
  }
  if (code === "storage-failed") {
    return "The browser could not cache the model files.";
  }
  if (code === "download-failed") {
    return "The model files could not be downloaded.";
  }
  return "The model could not be initialized.";
}

function isMemoryError(error: unknown): boolean {
  return /out of memory|allocation failed|memory limit|oom/i.test(
    errorMessage(error),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function readProgress(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.progress !== "number") return undefined;
  const normalized = value.progress > 1 ? value.progress / 100 : value.progress;
  return Number.isFinite(normalized)
    ? Math.max(0, Math.min(1, normalized))
    : undefined;
}

function readProgressMessage(value: unknown): string {
  if (!isRecord(value)) return "Loading model";
  if (typeof value.file === "string") return `Loading ${value.file}`;
  if (typeof value.status === "string") return value.status;
  return "Loading model";
}

function postError(code: MoonshineWorkerErrorCode, message: string): void {
  scope.postMessage({ type: "error", code, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
