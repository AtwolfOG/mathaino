# Transcription architecture

## Provider contract

`src/application/transcription.ts` defines provider identity, recorded-audio versus
live-speech capability, initialization progress, normalized results, cancellation,
cleanup, and structured failures. Recording, React state, grading, and persistence
remain outside provider implementations.

Successful providers return transcript text and provider metadata. Only transcript
text is submitted to `/api/voice-recitation-attempts`; the server authenticates the
request, resolves the owner-scoped verse, applies the existing comparison engine,
and atomically persists the attempt and progress. Provider metadata, audio, and a
separate transcript record are not persisted.

## Selection order

Automatic mode uses:

1. Moonshine Base, or Tiny when the optional `navigator.deviceMemory` hint is at
   most 4 GB.
2. Moonshine Tiny after a recoverable Base model or memory failure.
3. Native on-device Web Speech when local English dictation is reported available.
4. Online Web Speech only after explicit learner consent.
5. Typed recitation.

Manual selection does not silently switch providers. Local Whisper is an explicit
development-only selection.

## Moonshine

Moonshine runs in a module Web Worker through `@huggingface/transformers` 4.3.2.
The pinned models are:

- Base: `onnx-community/moonshine-base-ONNX` revision
  `b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad`.
- Tiny: `onnx-community/moonshine-tiny-ONNX` revision
  `a6da1241cd305dcd64eab1edbd615f2bb9aabb95`.

WebGPU is preferred and WebAssembly remains available when WebGPU is absent or its
backend cannot initialize. Browser recordings are decoded, downmixed, and resampled
to mono 16 kHz PCM before transfer to the worker. Model and WASM caching use the
Transformers.js browser cache support. The application cannot guarantee that a
browser will retain cached assets under storage pressure.

The initial model download requires network access. Offline transcription is only
available after the selected model and runtime assets are actually cached and can
be loaded without a network response. The UI does not claim offline readiness from
capability detection alone.

## Web Speech

Native Web Speech requires `SpeechRecognition`, `processLocally`, `available()`,
and `install()`. Mathaino checks `en-US` dictation availability and installs a
language pack only after an explicit learner action. It never silently downgrades
native recognition to an online service.

Ordinary Web Speech is separate, disabled by default, and requires per-selection
consent explaining that a browser vendor may process speech audio.

## Local Mac Whisper

The optional provider uses whisper.cpp with Whisper Small.en. It is disabled in
test and production regardless of configuration.

```text
LOCAL_WHISPER_ENABLED=false
LOCAL_WHISPER_URL=http://127.0.0.1:8080
```

Build whisper.cpp on the Mac, download `ggml-small.en.bin`, then run from the
whisper.cpp checkout:

```sh
cmake -B build
cmake --build build --config Release
sh ./models/download-ggml-model.sh small.en
./build/bin/whisper-server --host 127.0.0.1 --port 8080 --model models/ggml-small.en.bin --language en
```

Apple Silicon acceleration is used by the normal macOS build when available.
Actual memory use must be checked on the target 8 GB Mac. The server must remain
bound to loopback and must not run with administrative privileges. Mathaino accepts
only an exact `127.0.0.1` or `[::1]` URL with an explicit port, validates PCM mono
16 kHz WAV input, blocks redirects, and applies a timeout.

## Privacy and cost

Moonshine and native on-device Web Speech keep speech processing on the device.
Moonshine audio is not uploaded to a Mathaino transcription endpoint. Local Whisper
sends WAV only to the authenticated development route and fixed loopback process.
Online Web Speech may use a third-party browser-vendor service after consent.

Local/browser inference has no per-minute paid transcription API fee. Model weights
and runtime assets still consume hosting bandwidth, network bandwidth, cache space,
memory, CPU, and GPU resources.

## Troubleshooting

- Model download failure: check connectivity, content blocking, and browser storage.
- Storage failure: free site data or select Tiny; clearing data requires downloading
  the model again.
- Memory failure: select Tiny and close memory-heavy tabs.
- WebGPU failure: use Automatic mode so the runtime can try WebAssembly.
- Native language pack unavailable: use the explicit install/check action or choose
  another local mode.
- Local Whisper unavailable: confirm development mode, loopback binding, model path,
  and port.
- Recognition errors: inspect the transcript and retry; biblical names and archaic
  KJV wording may be misrecognized. Mathaino never substitutes the expected verse.

## Testing and deployment

Run `npm test`, `npm run test:integration`, `npm run lint`, `npm run typecheck`, and
`npm run build`. Provider tests use deterministic workers and browser API fakes;
real model downloads and device compatibility require the manual matrix in
`voice-recitation.md`.

Production requires HTTPS for microphone access. It requires no transcription API
key and must not deploy or expose the local whisper.cpp route as a production
inference service.
