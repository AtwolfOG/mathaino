import type { AuthenticationContext } from "../../application/authentication-context.ts";
import {
  NoSpeechDetectedError,
  TranscriptionError,
  TranscriptionTimeoutError,
  type VoiceRecitationService,
} from "../../application/voice-recitation.ts";
import {
  RecitationConflictError,
  RecitationIneligibleError,
  RecitationNotFoundError,
  RecitationValidationError,
} from "../../application/recitation.ts";

export async function handleVoiceRecitationRequest(
  request: Request,
  service: VoiceRecitationService,
  authentication: AuthenticationContext,
  trustedOrigin = new URL(request.url).origin,
): Promise<Response> {
  if (!(await authentication.getUserId()))
    return responseJson({ error: "Authentication required." }, 401);
  if (new URL(request.url).search)
    return responseJson({ error: "Unsupported query parameters." }, 400);
  if (request.method !== "POST")
    return Response.json(
      { error: "Method not allowed." },
      { status: 405, headers: { ...responseHeaders, allow: "POST" } },
    );
  if (request.headers.get("origin") !== trustedOrigin)
    return responseJson({ error: "Invalid request origin." }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !==
    "multipart/form-data"
  )
    return responseJson({ error: "Multipart audio upload required." }, 415);
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxRequestBytes)
  )
    return responseJson({ error: "Audio upload is too large." }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return responseJson({ error: "Invalid audio upload." }, 400);
  }
  if (
    [...form.keys()].sort().join(",") !==
    "audio,durationSeconds,itemId,operationId"
  )
    return responseJson({ error: "Invalid audio upload." }, 400);
  const itemId = form.get("itemId");
  const operationId = form.get("operationId");
  const durationValue = form.get("durationSeconds");
  const audio = form.get("audio");
  if (
    typeof itemId !== "string" ||
    !uuid.test(itemId) ||
    typeof operationId !== "string" ||
    !uuid.test(operationId) ||
    typeof durationValue !== "string" ||
    !(audio instanceof File)
  )
    return responseJson({ error: "Invalid audio upload." }, 400);
  const durationSeconds = Number(durationValue);
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < minDurationSeconds ||
    durationSeconds > maxDurationSeconds
  )
    return responseJson(
      { error: "Recording duration must be between 0.25 and 120 seconds." },
      400,
    );
  const mediaType = audio.type.toLowerCase().split(";", 1)[0] ?? "";
  if (!supportedMediaTypes.has(mediaType))
    return responseJson({ error: "Unsupported audio format." }, 415);
  if (audio.size === 0)
    return responseJson({ error: "The recording is empty." }, 400);
  if (audio.size > maxAudioBytes)
    return responseJson({ error: "Audio upload is too large." }, 413);
  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (!matchesAudioContainer(mediaType, bytes))
    return responseJson({ error: "Unsupported audio format." }, 415);

  try {
    const result = await service.submit(authentication, {
      itemId,
      operationId,
      recording: {
        bytes,
        mediaType,
        durationSeconds,
      },
    });
    return responseJson(result, result.status === "recorded" ? 201 : 200);
  } catch (error) {
    if (error instanceof NoSpeechDetectedError)
      return responseJson({ error: error.message }, 422);
    if (error instanceof TranscriptionTimeoutError)
      return responseJson({ error: error.message }, 504);
    if (error instanceof TranscriptionError)
      return responseJson({ error: error.message }, 502);
    if (error instanceof RecitationValidationError)
      return responseJson({ error: error.message }, 400);
    if (error instanceof RecitationNotFoundError)
      return responseJson({ error: error.message }, 404);
    if (
      error instanceof RecitationConflictError ||
      error instanceof RecitationIneligibleError
    )
      return responseJson({ error: error.message }, 409);
    throw error;
  }
}

const maxAudioBytes = 5_000_000;
const maxRequestBytes = maxAudioBytes + 100_000;
const minDurationSeconds = 0.25;
const maxDurationSeconds = 120;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const supportedMediaTypes = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);
const responseHeaders = {
  "cache-control": "private, no-store",
  vary: "Cookie",
};

function responseJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: responseHeaders });
}

function matchesAudioContainer(mediaType: string, bytes: Uint8Array) {
  if (mediaType === "audio/webm")
    return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  if (mediaType === "audio/ogg")
    return startsWith(bytes, [0x4f, 0x67, 0x67, 0x53]);
  if (mediaType === "audio/mp4")
    return (
      bytes.length >= 8 &&
      startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])
    );
  if (mediaType === "audio/mpeg")
    return (
      startsWith(bytes, [0x49, 0x44, 0x33]) ||
      (bytes[0] === 0xff &&
        bytes[1] !== undefined &&
        (bytes[1] & 0xe0) === 0xe0)
    );
  if (mediaType === "audio/wav" || mediaType === "audio/x-wav")
    return (
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes.length >= 12 &&
      startsWith(bytes.subarray(8), [0x57, 0x41, 0x56, 0x45])
    );
  return false;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}
