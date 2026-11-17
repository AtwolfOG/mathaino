import { expect, test, vi } from "vitest";
import {
  MOONSHINE_MODELS,
  MoonshineTranscriptionManager,
  createMoonshineProvider,
  selectMoonshineRuntime,
  type MoonshineWorker,
  type MoonshineWorkerFactory,
} from "@/infrastructure/transcription/moonshine";

class FakeWorker implements MoonshineWorker {
  readonly postMessage = vi.fn(
    (message: unknown, transfer?: readonly Transferable[]) => {
      this.posts.push({ message, transfer });
    },
  );
  readonly terminate = vi.fn();
  readonly posts: Array<{
    message: unknown;
    transfer?: readonly Transferable[];
  }> = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

function setupProvider(variant: "base" | "tiny" = "base") {
  const workers: FakeWorker[] = [];
  const workerFactory: MoonshineWorkerFactory = () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  };
  const prepareAudio = vi
    .fn()
    .mockResolvedValue(new Float32Array([0.25, -0.25]));
  const provider = createMoonshineProvider({
    variant,
    workerFactory,
    prepareAudio,
    runtime: { hasWebGpu: true },
  });
  return { provider, workers, prepareAudio };
}

const input = {
  kind: "recorded-audio" as const,
  bytes: new Uint8Array([1, 2, 3]),
  mediaType: "audio/webm",
  durationSeconds: 1,
};

test("loads and transcribes with one worker, cache config, progress, and transfers audio", async () => {
  const { provider, workers } = setupProvider();
  const updates: unknown[] = [];
  const first = provider.initialize((update) => updates.push(update));
  const duplicate = provider.initialize((update) => updates.push(update));
  expect(workers).toHaveLength(1);
  expect(workers[0]!.posts[0]!.message).toMatchObject({
    type: "initialize",
    model: MOONSHINE_MODELS.base,
    environment: { useBrowserCache: true, allowLocalModels: false },
    runtime: { device: "webgpu", dtype: "q4" },
  });
  workers[0]!.emit({
    type: "progress",
    progress: 0.5,
    message: "Downloading model",
  });
  workers[0]!.emit({ type: "ready" });
  await Promise.all([first, duplicate]);
  expect(updates).toContainEqual({
    status: "progress",
    progress: 0.5,
    message: "Downloading model",
  });

  const operation = provider.transcribe(input, new AbortController().signal);
  await vi.waitFor(() => expect(workers[0]!.posts).toHaveLength(2));
  const transcribePost = workers[0]!.posts[1]!;
  expect(transcribePost.message).toMatchObject({
    type: "transcribe",
    sampleRate: 16_000,
  });
  const samples = (transcribePost.message as { samples: Float32Array }).samples;
  expect(transcribePost.transfer).toEqual([samples.buffer]);
  workers[0]!.emit({ type: "result", text: "Thy word" });
  await expect(operation).resolves.toMatchObject({ text: "Thy word" });
});

test("prefers WebGPU but falls back to WASM without rejecting the browser", () => {
  expect(selectMoonshineRuntime({ hasWebGpu: true })).toEqual({
    device: "webgpu",
    dtype: "q4",
  });
  expect(selectMoonshineRuntime({ hasWebGpu: false })).toEqual({
    device: "wasm",
    dtype: "q8",
  });
});

test("retries the same model with WASM after recoverable WebGPU initialization failure", async () => {
  const { provider, workers } = setupProvider("base");
  const initialization = provider.initialize(vi.fn());

  workers[0]!.emit({
    type: "error",
    code: "model-failed",
    message: "WebGPU initialization failed.",
  });

  await vi.waitFor(() => expect(workers).toHaveLength(2));
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  expect(workers[1]!.posts[0]!.message).toMatchObject({
    type: "initialize",
    model: MOONSHINE_MODELS.base,
    runtime: { device: "wasm", dtype: "q8" },
  });
  workers[1]!.emit({ type: "ready" });

  await expect(initialization).resolves.toBeUndefined();
});

test.each(["construction", "initialization message"] as const)(
  "maps worker %s failures to recoverable provider errors",
  async (failurePoint) => {
    const worker = new FakeWorker();
    if (failurePoint === "initialization message")
      worker.postMessage.mockImplementationOnce(() => {
        throw new DOMException("Worker blocked.", "SecurityError");
      });
    const provider = createMoonshineProvider({
      variant: "base",
      workerFactory: () => {
        if (failurePoint === "construction")
          throw new DOMException("Worker blocked.", "SecurityError");
        return worker;
      },
      runtime: { hasWebGpu: false },
    });

    await expect(provider.initialize(vi.fn())).rejects.toMatchObject({
      code: "initialization-failed",
      recoverable: true,
      providerId: "moonshine-base",
    });
    if (failurePoint === "initialization message")
      expect(worker.terminate).toHaveBeenCalledOnce();
  },
);

test("maps unavailable model files and rejects malformed worker results", async () => {
  const unavailable = setupProvider();
  const initialization = unavailable.provider.initialize(vi.fn());
  unavailable.workers[0]!.emit({
    type: "error",
    code: "download-failed",
    message: "Model files could not be downloaded.",
  });
  await expect(initialization).rejects.toMatchObject({
    code: "model-files-unavailable",
    recoverable: true,
  });

  const malformed = setupProvider();
  const ready = malformed.provider.initialize(vi.fn());
  malformed.workers[0]!.emit({ type: "ready" });
  await ready;
  const operation = malformed.provider.transcribe(
    input,
    new AbortController().signal,
  );
  await vi.waitFor(() => expect(malformed.workers[0]!.posts).toHaveLength(2));
  malformed.workers[0]!.emit({ type: "result", text: 42 });
  await expect(operation).rejects.toMatchObject({
    code: "transcription-failed",
  });
});

test("cleans up and maps synchronous worker transcription failures", async () => {
  const { provider, workers } = setupProvider();
  const ready = provider.initialize(vi.fn());
  workers[0]!.emit({ type: "ready" });
  await ready;
  workers[0]!.postMessage.mockImplementationOnce(() => {
    throw new DOMException("Worker unavailable.", "InvalidStateError");
  });

  await expect(
    provider.transcribe(input, new AbortController().signal),
  ).rejects.toMatchObject({
    code: "transcription-failed",
    recoverable: true,
    providerId: "moonshine-base",
  });
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

test.each([
  ["storage-failed", "storage-failed"],
  ["memory-exhausted", "memory-exhausted"],
] as const)("maps worker %s errors to %s", async (workerCode, providerCode) => {
  const { provider, workers } = setupProvider();
  const initialization = provider.initialize(vi.fn());
  workers[0]!.emit({
    type: "error",
    code: workerCode,
    message: "Model initialization failed.",
  });
  await expect(initialization).rejects.toMatchObject({
    code: providerCode,
    recoverable: true,
  });
});

test("cancellation terminates the worker, discards late results, and cleanup is idempotent", async () => {
  const { provider, workers } = setupProvider();
  const ready = provider.initialize(vi.fn());
  workers[0]!.emit({ type: "ready" });
  await ready;
  const controller = new AbortController();
  const operation = provider.transcribe(input, controller.signal);
  await vi.waitFor(() => expect(workers[0]!.posts).toHaveLength(2));
  controller.abort();
  workers[0]!.emit({ type: "result", text: "late" });
  await expect(operation).rejects.toMatchObject({ code: "cancelled" });
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  await provider.cleanup();
  await provider.cleanup();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

test("times out stalled browser inference and releases its worker", async () => {
  vi.useFakeTimers();
  const workers: FakeWorker[] = [];
  const provider = createMoonshineProvider({
    variant: "base",
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    prepareAudio: async () => new Float32Array([0.1]),
    runtime: { hasWebGpu: false },
    timeoutMilliseconds: 10,
  });
  const ready = provider.initialize(vi.fn());
  workers[0]!.emit({ type: "ready" });
  await ready;
  const operation = provider.transcribe(input, new AbortController().signal);
  const rejection = expect(operation).rejects.toMatchObject({
    code: "transcription-timeout",
  });
  await vi.advanceTimersByTimeAsync(10);

  await rejection;
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  vi.useRealTimers();
});

test("cancelling WebGPU initialization does not start a WASM worker", async () => {
  const { provider, workers } = setupProvider();
  const initialization = provider.initialize(vi.fn());
  expect(workers).toHaveLength(1);

  await provider.cleanup();

  await expect(initialization).rejects.toMatchObject({ code: "cancelled" });
  expect(workers).toHaveLength(1);
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

test("automatically chooses Tiny only for a finite <=4GB memory hint", async () => {
  const base = setupProvider("base");
  const tiny = setupProvider("tiny");
  const manager = new MoonshineTranscriptionManager({
    base: base.provider,
    tiny: tiny.provider,
  });
  const initialized = manager.initialize({ deviceMemory: 4 });
  tiny.workers[0]!.emit({ type: "ready" });
  await initialized;
  expect(manager.selectedVariant).toBe("tiny");
  expect(base.workers).toHaveLength(0);
});

test("uses the browser deviceMemory hint when no hint is supplied", async () => {
  vi.stubGlobal("navigator", { deviceMemory: 4 });
  const base = setupProvider("base");
  const tiny = setupProvider("tiny");
  const manager = new MoonshineTranscriptionManager({
    base: base.provider,
    tiny: tiny.provider,
  });
  const initialized = manager.initialize({});
  tiny.workers[0]!.emit({ type: "ready" });
  await initialized;
  expect(manager.selectedVariant).toBe("tiny");
  vi.unstubAllGlobals();
});

test("honors manual override regardless of device memory", async () => {
  const base = setupProvider("base");
  const tiny = setupProvider("tiny");
  const manager = new MoonshineTranscriptionManager({
    base: base.provider,
    tiny: tiny.provider,
  });
  const initialized = manager.initialize({
    variant: "base",
    deviceMemory: 2,
  });
  base.workers[0]!.emit({ type: "ready" });
  await initialized;
  expect(manager.selectedVariant).toBe("base");
  expect(tiny.workers).toHaveLength(0);
});

test("recovers from Base model failure with Tiny and does not retry failed Base", async () => {
  const base = setupProvider("base");
  const tiny = setupProvider("tiny");
  const manager = new MoonshineTranscriptionManager({
    base: base.provider,
    tiny: tiny.provider,
  });
  const initialized = manager.initialize({ deviceMemory: 8 });
  base.workers[0]!.emit({
    type: "error",
    code: "memory-exhausted",
    message: "Not enough memory.",
  });
  await vi.waitFor(() => expect(tiny.workers).toHaveLength(1));
  tiny.workers[0]!.emit({ type: "ready" });
  await initialized;
  expect(base.workers[0]!.terminate).toHaveBeenCalledOnce();
  expect(manager.selectedVariant).toBe("tiny");

  await manager.cleanup();
  const secondInitialization = manager.initialize({ deviceMemory: 8 });
  tiny.workers[1]!.emit({ type: "ready" });
  await secondInitialization;
  expect(base.workers).toHaveLength(1);
});
