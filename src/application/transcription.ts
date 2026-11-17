export type TranscriptionInputKind = "recorded-audio" | "live-speech";

export interface RecordedAudioInput {
  kind: "recorded-audio";
  bytes: Uint8Array;
  mediaType: string;
  durationSeconds: number;
}

export interface LiveSpeechInput {
  kind: "live-speech";
}

export type TranscriptionInput = RecordedAudioInput | LiveSpeechInput;

export function validateRecordedAudioSize(size: number): void {
  if (!Number.isFinite(size) || size < 0 || size > 5_000_000)
    throw new RangeError("Recorded audio must be 5 MB or smaller.");
}

export type TranscriptionRuntimeHints = Readonly<
  Record<string, string | number | boolean | undefined>
>;

export interface TranscriptionCapabilityRequest {
  inputKind: TranscriptionInputKind;
  runtimeHints: TranscriptionRuntimeHints;
}

export type TranscriptionCapability =
  { supported: true } | { supported: false; reason: string };

export interface TranscriptionInitializationUpdate {
  status: "initializing" | "progress" | "ready";
  message?: string;
  progress?: number;
}

export interface TranscriptionProviderMetadata {
  id: string;
  label: string;
}

export interface TranscriptionResult {
  text: string;
  provider: TranscriptionProviderMetadata;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresOnlineConsent: boolean;
  getCapability(
    request: TranscriptionCapabilityRequest,
  ): TranscriptionCapability | Promise<TranscriptionCapability>;
  initialize(
    onUpdate: (update: TranscriptionInitializationUpdate) => void,
  ): Promise<void>;
  transcribe(
    input: TranscriptionInput,
    signal: AbortSignal,
  ): Promise<TranscriptionResult>;
  stop?(): void;
  cleanup(): Promise<void>;
}

export type TranscriptionErrorCode =
  | "provider-not-found"
  | "provider-unsupported"
  | "consent-required"
  | "provider-busy"
  | "not-initialized"
  | "input-kind-mismatch"
  | "cancelled"
  | "model-files-unavailable"
  | "storage-failed"
  | "model-failed"
  | "memory-exhausted"
  | "language-pack-unavailable"
  | "language-pack-install-failed"
  | "microphone-permission-denied"
  | "no-speech"
  | "speech-service-unavailable"
  | "transcription-timeout"
  | "initialization-failed"
  | "transcription-failed";

export interface TranscriptionProviderErrorOptions {
  code: TranscriptionErrorCode;
  message: string;
  recoverable: boolean;
  providerId?: string;
  cause?: unknown;
}

export class TranscriptionProviderError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly recoverable: boolean;
  readonly providerId?: string;

  constructor(options: TranscriptionProviderErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "TranscriptionProviderError";
    this.code = options.code;
    this.recoverable = options.recoverable;
    this.providerId = options.providerId;
  }
}

export interface InitializeTranscriptionOptions {
  providerId: string;
  inputKind: TranscriptionInputKind;
  runtimeHints?: TranscriptionRuntimeHints;
  onlineConsent?: boolean;
  onUpdate?: (update: TranscriptionInitializationUpdate) => void;
}

export class TranscriptionManager {
  private readonly providers: ReadonlyMap<string, TranscriptionProvider>;
  private readonly failedProviders = new Map<string, unknown>();
  private selected?: {
    provider: TranscriptionProvider;
    inputKind: TranscriptionInputKind;
  };
  private initializing?: TranscriptionProvider;
  private active?: {
    controller: AbortController;
    operation: Promise<TranscriptionResult>;
    token: symbol;
  };

  constructor(providers: readonly TranscriptionProvider[]) {
    this.providers = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
  }

  get selectedProvider(): TranscriptionProviderMetadata | undefined {
    if (!this.selected) return undefined;
    return {
      id: this.selected.provider.id,
      label: this.selected.provider.label,
    };
  }

  async initialize(
    options: InitializeTranscriptionOptions,
  ): Promise<TranscriptionCapability> {
    const provider = this.providers.get(options.providerId);
    if (!provider) {
      throw transcriptionError(
        "provider-not-found",
        `Transcription provider '${options.providerId}' was not found.`,
        false,
        options.providerId,
      );
    }
    if (this.active) {
      throw transcriptionError(
        "provider-busy",
        "Cancel the active transcription before selecting a provider.",
        true,
        this.selected?.provider.id,
      );
    }
    if (this.failedProviders.has(provider.id)) {
      throw this.failedProviders.get(provider.id);
    }
    if (provider.requiresOnlineConsent && options.onlineConsent !== true) {
      throw transcriptionError(
        "consent-required",
        `Online consent is required for ${provider.label}.`,
        true,
        provider.id,
      );
    }

    let capability: TranscriptionCapability;
    try {
      capability = await provider.getCapability({
        inputKind: options.inputKind,
        runtimeHints: options.runtimeHints ?? {},
      });
    } catch (error) {
      this.failedProviders.set(provider.id, error);
      throw error;
    }
    if (!capability.supported) {
      const error = transcriptionError(
        "provider-unsupported",
        capability.reason,
        true,
        provider.id,
      );
      throw error;
    }

    if (this.selected?.provider.id === provider.id) return capability;
    if (this.selected) {
      const previous = this.selected.provider;
      await previous.cleanup();
      this.selected = undefined;
    }

    try {
      this.initializing = provider;
      await provider.initialize(options.onUpdate ?? (() => undefined));
    } catch (error) {
      if (!isCancellation(error)) {
        this.failedProviders.set(provider.id, error);
        await provider.cleanup();
      }
      throw error;
    } finally {
      if (this.initializing === provider) this.initializing = undefined;
    }
    this.selected = { provider, inputKind: options.inputKind };
    return capability;
  }

  async transcribe(
    input: TranscriptionInput,
    signal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    if (!this.selected) {
      throw transcriptionError(
        "not-initialized",
        "Initialize a transcription provider before transcribing.",
        true,
      );
    }
    if (input.kind !== this.selected.inputKind) {
      throw transcriptionError(
        "input-kind-mismatch",
        `The selected provider was initialized for ${this.selected.inputKind}.`,
        true,
        this.selected.provider.id,
      );
    }
    if (this.active) {
      throw transcriptionError(
        "provider-busy",
        "A transcription is already active.",
        true,
        this.selected.provider.id,
      );
    }

    const { provider } = this.selected;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });

    const token = Symbol("transcription-operation");
    const operation = (async () => {
      try {
        const result = await provider.transcribe(input, controller.signal);
        return {
          text: result.text,
          provider: { id: provider.id, label: provider.label },
        };
      } catch (error) {
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
        if (this.active?.token === token) this.active = undefined;
      }
    })();
    this.active = { controller, operation, token };
    return operation;
  }

  async cancelActiveTranscription(): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    try {
      await active.operation;
    } catch {
      // The transcription caller receives the provider's original error.
    }
  }

  stopActiveTranscription(): void {
    if (this.active) this.selected?.provider.stop?.();
  }

  async cancelPendingInitialization(): Promise<void> {
    const provider = this.initializing;
    if (!provider) return;
    await provider.cleanup();
    if (this.initializing === provider) this.initializing = undefined;
  }

  async cleanup(): Promise<void> {
    await this.cancelActiveTranscription();
    await this.cancelPendingInitialization();
    const selected = this.selected;
    try {
      await selected?.provider.cleanup();
    } finally {
      this.selected = undefined;
      this.failedProviders.clear();
    }
  }
}

function isCancellation(error: unknown) {
  return (
    error instanceof TranscriptionProviderError && error.code === "cancelled"
  );
}

function transcriptionError(
  code: TranscriptionErrorCode,
  message: string,
  recoverable: boolean,
  providerId?: string,
) {
  return new TranscriptionProviderError({
    code,
    message,
    recoverable,
    providerId,
  });
}
