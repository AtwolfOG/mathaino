# Voice recitation

Voice recitation captures audio only after the learner selects **Start recording**.
The browser uploads the completed recording to Mathaino over the current origin.
The server authenticates the request, validates the multipart upload, sends the
audio to the configured Whisper-compatible provider, and grades the final
transcript with the same evaluator used by typed recitation.

Raw recordings are not written to Mathaino storage. Provider-side handling is
governed by the selected provider's account and retention settings. Do not enable
voice recitation until those settings satisfy the deployment's privacy policy.

## Configuration

Set these only in the server environment:

```text
TRANSCRIPTION_API_URL=https://api.openai.com/v1/audio/transcriptions
TRANSCRIPTION_API_KEY=...
TRANSCRIPTION_MODEL=whisper-1
```

Production must use HTTPS. `getUserMedia` is available only in secure contexts
(with loopback exceptions for local development), and `BETTER_AUTH_URL` already
rejects non-HTTPS production origins.

## Manual browser verification

Use a non-production test account and a short test verse. For each target below,
test both permission grant and denial, confirm the transcript appears before or
alongside grading, and verify **Type instead** remains available after every error.

| Target            | Manual checks                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Safari on macOS   | Record and stop an MP4/AAC browser recording; retry after denial; confirm the microphone indicator clears after stop and navigation. |
| Chrome desktop    | Record WebM/Opus; stop normally; disconnect the network during upload; retry; confirm typed fallback and no false success.           |
| Firefox desktop   | Record Ogg/Opus or the format Firefox selects; deny permission; test silence and provider-error recovery.                            |
| Chrome on Android | Test the built-in microphone, a 120-second automatic stop, rotation/reflow, network loss, and switching to typing.                   |
| Safari on iOS     | Test on a real device over HTTPS, grant and deny permission, stop recording, background/return behavior, and typed fallback.         |

Also verify an unsupported browser/format shows a useful message, an expired
session receives an authentication error, oversized/overlong recordings are
rejected, and no raw audio appears in application logs or database records.
