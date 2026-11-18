import type { AuthenticationContext } from "../../application/authentication-context.ts";
import {
  ReviewConflictError,
  ReviewIneligibleError,
  ReviewNotFoundError,
  ReviewValidationError,
  type ReviewService,
} from "../../application/review.ts";
import { normalizeRecitationText } from "../../domain/recitation-evaluation.ts";

export async function handleReviewRequest(
  request: Request,
  service: ReviewService,
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
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes)
    return responseJson({ error: "Request body is too large." }, 413);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return responseJson({ error: "Invalid review request." }, 400);
  }
  if (
    !recordWith(value, ["itemId", "operationId", "text"]) ||
    typeof value.itemId !== "string" ||
    !uuid.test(value.itemId) ||
    typeof value.operationId !== "string" ||
    !uuid.test(value.operationId) ||
    typeof value.text !== "string"
  )
    return responseJson({ error: "Invalid review request." }, 400);
  const normalized = normalizeRecitationText(value.text);
  if (normalized.length === 0)
    return responseJson({ error: "Type a review before submitting." }, 400);
  if ([...value.text].length > 10_000)
    return responseJson(
      { error: "Review must be 10,000 characters or fewer." },
      400,
    );
  if (normalized.split(" ").length > 1_000)
    return responseJson({ error: "Review must be 1,000 words or fewer." }, 400);
  try {
    const result = await service.submit(authentication, {
      itemId: value.itemId,
      operationId: value.operationId,
      text: value.text,
    });
    return responseJson(result, result.status === "recorded" ? 201 : 200);
  } catch (error) {
    if (error instanceof ReviewValidationError)
      return responseJson({ error: error.message }, 400);
    if (error instanceof ReviewNotFoundError)
      return responseJson({ error: error.message }, 404);
    if (
      error instanceof ReviewConflictError ||
      error instanceof ReviewIneligibleError
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
