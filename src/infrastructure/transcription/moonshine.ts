import {
  TranscriptionProviderError,
  type RecordedAudioInput,
  type TranscriptionInitializationUpdate,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "../../application/transcription.ts";
import { prepareMoonshineAudio } from "./moonshine-audio.ts";
import {
  parseWorkerMessage,
  type MoonshineRuntimeConfig,
  type MoonshineWorkerErrorCode,
} from "./moonshine-protocol.ts";

export type MoonshineVariant = "base" | "tiny";

export const MOONSHINE_MODELS = {
  base: {
    id: "onnx-community/moonshine-base-ONNX",
    revision: "b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad",
  },
  tiny: {
    id: "onnx-community/moonshine-tiny-ONNX",
    revision: "a6da1241cd305dcd64eab1edbd615f2bb9aabb95",
  },
} as const;

export interface MoonshineWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  terminate(): void;
}

export type MoonshineWorkerFactory = () => MoonshineWorker;

export interface MoonshineRuntimeHints {
  hasWebGpu: boolean;
}

export type MoonshineRuntime = MoonshineRuntimeConfig;

export function selectMoonshineRuntime(
  hints: MoonshineRuntimeHints,
): MoonshineRuntime {
  return hints.hasWebGpu
    ? { device: "webgpu", dtype: "q4" }
    : { device: "wasm", dtype: "q8" };
}

export function selectMoonshineVariant(
  override: MoonshineVariant | "auto" | undefined,
  deviceMemory: number | undefined,
): MoonshineVariant {
  if (override && override !== "auto") return override;
  return Number.isFinite(deviceMemory) && deviceMemory! <= 4 ? "tiny" : "base";
}

export function createMoonshineProvider(options: {
  variant: MoonshineVariant;
  workerFactory?: MoonshineWorkerFactory;
  prepareAudio?: (input: RecordedAudioInput) => Promise<Float32Array>;
  runtime?: MoonshineRuntimeHints;
  timeoutMilliseconds?: number;
}): TranscriptionProvider {
  const { variant } = options;
  const metadata = {
    id: `moonshine-${variant}`,
    label: `Moonshine ${variant === "base" ? "Base" : "Tiny"}`,
  };
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  const prepareAudio = options.prepareAudio ?? prepareMoonshineAudio;
  const preferredRuntime = selectMoonshineRuntime(
    options.runtime ?? { hasWebGpu: hasNavigatorGpu() },
  );
  let worker: MoonshineWorker | undefined;
  let initialization: Promise<void> | undefined;
  let initializationGeneration = 0;
  let initialized = false;
  const initializationCallbacks = new Set<
    (update: TranscriptionInitializationUpdate) => void
  >();
  let initializeSettlement:
    { resolve: () => void; reject: (error: unknown) => void } | undefined;
  let transcriptionSettlement:
    | {
        resolve: (result: TranscriptionResult) => void;
        reject: (error: unknown) => void;
        abort: () => void;
      }
    | undefined;

  const terminate = () => {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    worker = undefined;
    initialized = false;
  };

  const initializeRuntime = (runtime: MoonshineRuntime) => {
    try {
      worker = workerFactory();
      attachWorker(worker);
    } catch (cause) {
      terminate();
      return Promise.reject(
        providerError(
          "initialization-failed",
          "The transcription worker could not be started.",
          true,
          metadata.id,
          cause,
        ),
      );
    }
    return new Promise<void>((resolve, reject) => {
      initializeSettlement = { resolve, reject };
      try {
        worker!.postMessage({
          type: "initialize",
          model: MOONSHINE_MODELS[variant],
          environment: { useBrowserCache: true, allowLocalModels: false },
          runtime,
        });
      } catch (cause) {
        initializeSettlement = undefined;
        terminate();
        reject(
          providerError(
            "initialization-failed",
            "The transcription worker could not be started.",
            true,
            metadata.id,
            cause,
          ),
        );
      }
    });
  };

  const failMalformedMessage = () => {
    const error = providerError(
      "transcription-failed",
      "The transcription worker returned an invalid response.",
      true,
      metadata.id,
    );
    if (transcriptionSettlement) {
      const settlement = transcriptionSettlement;
      transcriptionSettlement = undefined;
      settlement.abort();
      settlement.reject(error);
    } else if (initializeSettlement) {
      initializeSettlement.reject(error);
      initializeSettlement = undefined;
    }
  };

  function attachWorker(nextWorker: MoonshineWorker) {
    nextWorker.onmessage = (event) => {
      const message = parseWorkerMessage(event.data);
      if (!message) {
        failMalformedMessage();
        return;
      }
      if (message.type === "progress" && initializeSettlement) {
        for (const callback of initializationCallbacks)
          callback(message.update);
        return;
      }
      if (message.type === "ready" && initializeSettlement) {
        initialized = true;
        for (const callback of initializationCallbacks) {
          callback({ status: "ready" });
        }
        initializationCallbacks.clear();
        initializeSettlement.resolve();
        initializeSettlement = undefined;
        return;
      }
      if (message.type === "result" && transcriptionSettlement) {
        const settlement = transcriptionSettlement;
        transcriptionSettlement = undefined;
        settlement.abort();
        settlement.resolve({ text: message.text, provider: metadata });
        return;
      }
      if (message.type === "error") {
        const error = mapWorkerError(
          message.code,
          message.message,
          metadata.id,
        );
        if (initializeSettlement) {
          initializeSettlement.reject(error);
          initializeSettlement = undefined;
          terminate();
        } else if (transcriptionSettlement) {
          const settlement = transcriptionSettlement;
          transcriptionSettlement = undefined;
          settlement.abort();
          settlement.reject(error);
        }
      }
    };
    nextWorker.onerror = () => {
      const error = providerError(
        initialized ? "transcription-failed" : "initialization-failed",
        "The transcription worker failed.",
        true,
        metadata.id,
      );
      if (initializeSettlement) {
        initializeSettlement.reject(error);
        initializeSettlement = undefined;
      }
      if (transcriptionSettlement) {
        transcriptionSettlement.reject(error);
        transcriptionSettlement = undefined;
      }
      terminate();
    };
  }

  return {
    ...metadata,
    requiresOnlineConsent: false,
    getCapability: ({ inputKind }) =>
      inputKind === "recorded-audio"
        ? { supported: true }
        : {
            supported: false,
            reason: "Moonshine accepts recorded audio only.",
          },
    initialize(onUpdate) {
      if (initialized) return Promise.resolve();
      initializationCallbacks.add(onUpdate);
      if (initialization) return initialization;
      onUpdate({
        status: "initializing",
        message: `Loading ${metadata.label}.`,
      });
      const generation = ++initializationGeneration;
      initialization = (async () => {
        try {
          await initializeRuntime(preferredRuntime);
        } catch (error) {
          if (generation !== initializationGeneration) throw error;
          if (
            preferredRuntime.device !== "webgpu" ||
            !isRuntimeFallbackError(error)
          ) {
            throw error;
          }
          onUpdate({
            status: "initializing",
            message: `WebGPU was unavailable. Loading ${metadata.label} with WebAssembly.`,
          });
          if (generation !== initializationGeneration)
            throw cancelledError(metadata.id);
          await initializeRuntime({ device: "wasm", dtype: "q8" });
        }
      })();
      return initialization;
    },
    async transcribe(input, signal) {
      if (input.kind !== "recorded-audio") {
        throw providerError(
          "input-kind-mismatch",
          "Moonshine accepts recorded audio only.",
          true,
          metadata.id,
        );
      }
      if (!initialized || !worker) {
        throw providerError(
          "not-initialized",
          "Initialize Moonshine before transcribing.",
          true,
          metadata.id,
        );
      }
      if (signal.aborted) throw cancelledError(metadata.id);
      const activeWorker = worker;
      let samples: Float32Array;
      try {
        samples = await prepareAudio(input);
      } catch (cause) {
        throw providerError(
          "transcription-failed",
          "The recorded audio could not be decoded.",
          true,
          metadata.id,
          cause,
        );
      }
      if (signal.aborted || worker !== activeWorker) {
        if (worker === activeWorker) terminate();
        throw cancelledError(metadata.id);
      }
      return new Promise<TranscriptionResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!transcriptionSettlement) return;
          transcriptionSettlement = undefined;
          terminate();
          reject(
            providerError(
              "transcription-timeout",
              "Browser transcription timed out.",
              true,
              metadata.id,
            ),
          );
        }, options.timeoutMilliseconds ?? 20_000);
        const abort = () => {
          if (!transcriptionSettlement) return;
          transcriptionSettlement = undefined;
          clearTimeout(timeout);
          terminate();
          reject(cancelledError(metadata.id));
        };
        signal.addEventListener("abort", abort, { once: true });
        transcriptionSettlement = {
          resolve: (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          abort: () => {
            clearTimeout(timeout);
            signal.removeEventListener("abort", abort);
          },
        };
        try {
          activeWorker.postMessage(
            { type: "transcribe", samples, sampleRate: 16_000 },
            [samples.buffer],
          );
        } catch (cause) {
          const settlement = transcriptionSettlement;
          transcriptionSettlement = undefined;
          settlement?.abort();
          terminate();
          reject(
            providerError(
              "transcription-failed",
              "The transcription worker could not process the recording.",
              true,
              metadata.id,
              cause,
            ),
          );
        }
      });
    },
    async cleanup() {
      initializationGeneration += 1;
      const initializing = initializeSettlement;
      initializeSettlement = undefined;
      if (initializing) initializing.reject(cancelledError(metadata.id));
      const settlement = transcriptionSettlement;
      transcriptionSettlement = undefined;
      if (settlement) {
        settlement.abort();
        settlement.reject(cancelledError(metadata.id));
      }
      if (worker) {
        if (initialized) worker.postMessage({ type: "dispose" });
        terminate();
      }
      initialization = undefined;
      initializationCallbacks.clear();
    },
  };
}

export class MoonshineTranscriptionManager {
  private selected?: MoonshineVariant;
  private readonly failed = new Map<MoonshineVariant, unknown>();

  constructor(
    private readonly providers: Readonly<
      Record<MoonshineVariant, TranscriptionProvider>
    >,
  ) {}

  get selectedVariant(): MoonshineVariant | undefined {
    return this.selected;
  }

  async initialize(options: {
    variant?: MoonshineVariant | "auto";
    deviceMemory?: number;
    onUpdate?: (update: TranscriptionInitializationUpdate) => void;
  }): Promise<void> {
    const requested = selectMoonshineVariant(
      options.variant,
      options.deviceMemory ?? readDeviceMemory(),
    );
    if (this.selected === requested) return;
    if (this.selected) await this.cleanup();
    const automatic = !options.variant || options.variant === "auto";
    const candidates: MoonshineVariant[] =
      automatic && requested === "base" ? ["base", "tiny"] : [requested];
    let lastError: unknown;
    for (const variant of candidates) {
      if (this.failed.has(variant)) {
        lastError = this.failed.get(variant);
        continue;
      }
      const provider = this.providers[variant];
      try {
        await provider.initialize(options.onUpdate ?? (() => undefined));
        this.selected = variant;
        return;
      } catch (error) {
        this.failed.set(variant, error);
        lastError = error;
        await provider.cleanup();
        if (!automatic || !isBaseFallbackError(error)) throw error;
      }
    }
    throw (
      lastError ??
      providerError(
        "initialization-failed",
        "No Moonshine model is available.",
        true,
      )
    );
  }

  async transcribe(
    input: RecordedAudioInput,
    signal = new AbortController().signal,
  ): Promise<TranscriptionResult> {
    if (!this.selected) {
      throw providerError(
        "not-initialized",
        "Initialize Moonshine before transcribing.",
        true,
      );
    }
    return this.providers[this.selected].transcribe(input, signal);
  }

  async cleanup(): Promise<void> {
    if (!this.selected) return;
    await this.providers[this.selected].cleanup();
    this.selected = undefined;
  }
}

function defaultWorkerFactory(): MoonshineWorker {
  return new Worker(new URL("./moonshine.worker.ts", import.meta.url), {
    type: "module",
  });
}

function hasNavigatorGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function readDeviceMemory(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  const value = (navigator as Navigator & { deviceMemory?: unknown })
    .deviceMemory;
  return typeof value === "number" ? value : undefined;
}

function isBaseFallbackError(error: unknown): boolean {
  return (
    error instanceof TranscriptionProviderError &&
    error.recoverable &&
    [
      "initialization-failed",
      "model-files-unavailable",
      "storage-failed",
      "model-failed",
      "memory-exhausted",
    ].includes(error.code)
  );
}

function isRuntimeFallbackError(error: unknown): boolean {
  return (
    error instanceof TranscriptionProviderError && error.code === "model-failed"
  );
}

function mapWorkerError(
  code: MoonshineWorkerErrorCode,
  message: string,
  providerId: string,
): TranscriptionProviderError {
  const mappedCode = {
    "download-failed": "model-files-unavailable",
    "storage-failed": "storage-failed",
    "model-failed": "model-failed",
    "memory-exhausted": "memory-exhausted",
    "inference-failed": "transcription-failed",
  } as const;
  return providerError(mappedCode[code], message, true, providerId);
}

function cancelledError(providerId: string) {
  return providerError(
    "cancelled",
    "Transcription was cancelled.",
    true,
    providerId,
  );
}

function providerError(
  code: ConstructorParameters<typeof TranscriptionProviderError>[0]["code"],
  message: string,
  recoverable: boolean,
  providerId?: string,
  cause?: unknown,
) {
  return new TranscriptionProviderError({
    code,
    message,
    recoverable,
    providerId,
    cause,
  });
}
