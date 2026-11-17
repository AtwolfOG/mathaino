import type { AuthenticationContext } from "../../application/authentication-context.ts";
import {
  LocalWhisperCancelledError,
  LocalWhisperTimeoutError,
  LocalWhisperUnavailableError,
  type LocalWhisperTranscriber,
} from "../../infrastructure/transcription/local-whisper-server.ts";
import { validatePcm16Mono16kWav } from "../../infrastructure/transcription/wav.ts";
import { readLimitedBody } from "./read-limited-body.ts";

export async function handleLocalWhisperTranscriptionRequest(
  request: Request,
  transcriber: LocalWhisperTranscriber | undefined,
  authentication: AuthenticationContext,
  trustedOrigin = new URL(request.url).origin,
): Promise<Response> {
  if (!transcriber) return json({ error: "Not found." }, 404);
  if (!(await authentication.getUserId()))
    return json({ error: "Authentication required." }, 401);
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  if (new URL(request.url).search)
    return json({ error: "Unsupported query parameters." }, 400);
  if (request.headers.get("origin") !== trustedOrigin)
    return json({ error: "Invalid request origin." }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !==
    "multipart/form-data"
  )
    return json({ error: "Multipart WAV upload required." }, 415);
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxRequestBytes)
  )
    return json({ error: "WAV upload is too large." }, 413);

  const body = await readLimitedBody(request, maxRequestBytes);
  if (body === null) return json({ error: "WAV upload is too large." }, 413);
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body,
    }).formData();
  } catch {
    return json({ error: "Invalid WAV upload." }, 400);
  }
  const entries = [...form.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "file")
    return json({ error: "Invalid WAV upload." }, 400);
  const file = entries[0][1];
  if (!(file instanceof File))
    return json({ error: "Invalid WAV upload." }, 400);
  if (file.type.toLowerCase() !== "audio/wav")
    return json({ error: "A WAV recording is required." }, 415);
  if (file.size > maxWavBytes)
    return json({ error: "WAV upload is too large." }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const wav = validatePcm16Mono16kWav(bytes);
  if (!wav) return json({ error: "A PCM mono 16 kHz WAV is required." }, 415);
  if (wav.durationSeconds < 0.25 || wav.durationSeconds > 120)
    return json(
      { error: "Recording duration must be between 0.25 and 120 seconds." },
      400,
    );

  try {
    return json({ text: await transcriber.transcribe(bytes, request.signal) });
  } catch (error) {
    if (error instanceof LocalWhisperCancelledError)
      return json({ error: "Local transcription was cancelled." }, 408);
    if (error instanceof LocalWhisperTimeoutError)
      return json({ error: "Local transcription timed out." }, 504);
    if (error instanceof LocalWhisperUnavailableError)
      return json({ error: "Local transcription is unavailable." }, 502);
    throw error;
  }
}

const maxWavBytes = 44 + 120 * 16_000 * 2;
const maxRequestBytes = maxWavBytes + 100_000;
const responseHeaders = {
  "cache-control": "private, no-store",
  vary: "Cookie",
};

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, {
    status,
    headers: { ...responseHeaders, ...headers },
  });
}
