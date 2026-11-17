# Voice recitation

Voice recitation is local-first. The default browser path records audio after an
explicit learner action and transcribes it in a Web Worker with Moonshine. Only the
final transcript is sent to Mathaino for the same assessment and persistence used
by typed recitation.

Moonshine model weights require an initial download. A model is described as ready
only after initialization succeeds. Transformers.js uses supported browser caches,
but cache persistence and available storage remain browser-controlled.

Ordinary Web Speech may send audio to a browser-vendor service and is disabled
until the learner explicitly consents. Native Web Speech is considered on-device
only when the browser reports local English dictation support. Raw recordings and
transcripts are not stored as separate Mathaino database records.

See [transcription-architecture.md](transcription-architecture.md) for provider,
privacy, development, troubleshooting, and testing details.

## Manual browser verification

Use a non-production account and short verse. Check permission grant and denial,
model download status, transcript display, retry, cancellation, microphone release,
and the always-available typed path.

| Target            | Required checks                                                                |
| ----------------- | ------------------------------------------------------------------------------ |
| Chrome desktop    | WebGPU and WASM paths, model cache reuse, WebM/Opus, offline-after-cache check |
| Firefox desktop   | WASM practicality, Ogg/Opus, unsupported Web Speech handling                   |
| Safari on macOS   | MP4/AAC decoding, worker/model support, microphone release                     |
| Chrome on Android | Tiny selection on low-memory devices, duration limit, rotation and reflow      |
| Safari on iOS     | Real-device HTTPS capture, background/return, storage pressure, typed fallback |

These targets are a verification checklist, not a compatibility claim. Record the
actual browser versions and hardware used before claiming support.
