import type { AuthenticationContext } from "../../application/authentication-context.ts";
import {
  RecitationConflictError,
  RecitationIneligibleError,
  RecitationNotFoundError,
  RecitationValidationError,
  type RecitationService,
} from "../../application/recitation.ts";
import { normalizeRecitationText } from "../../domain/recitation-evaluation.ts";
import { readLimitedBody } from "./read-limited-body.ts";

export async function handleVoiceRecitationRequest(
  request: Request,
  service: RecitationService,
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
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return responseJson({ error: "JSON content type required." }, 415);
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBodyBytes)
  )
    return responseJson({ error: "Request body is too large." }, 413);
  const body = await readLimitedBody(request, maxBodyBytes);
  if (body === null)
    return responseJson({ error: "Request body is too large." }, 413);
  const text = new TextDecoder().decode(body);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return responseJson({ error: "Invalid recitation request." }, 400);
  }
  if (
    !recordWith(value, ["itemId", "operationId", "text"]) ||
    typeof value.itemId !== "string" ||
    !uuid.test(value.itemId) ||
    typeof value.operationId !== "string" ||
    !uuid.test(value.operationId) ||
    typeof value.text !== "string"
  )
    return responseJson({ error: "Invalid recitation request." }, 400);
  const normalized = normalizeRecitationText(value.text);
  if (normalized.length === 0)
    return responseJson(
      { error: "Speak a recitation before submitting." },
      400,
    );
  if ([...value.text].length > 10_000)
    return responseJson(
      { error: "Recitation must be 10,000 characters or fewer." },
      400,
    );
  if (normalized.split(" ").length > 1_000)
    return responseJson(
      { error: "Recitation must be 1,000 words or fewer." },
      400,
    );

  try {
    const result = await service.submit(authentication, {
      itemId: value.itemId,
      operationId: value.operationId,
      text: value.text,
      mode: "voice",
    });
    return responseJson(result, result.status === "recorded" ? 201 : 200);
  } catch (error) {
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

const maxBodyBytes = 50_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const responseHeaders = {
  "cache-control": "private, no-store",
  vary: "Cookie",
};

function responseJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: responseHeaders });
}

function recordWith(
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}
