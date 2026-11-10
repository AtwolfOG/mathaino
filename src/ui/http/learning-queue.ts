import type { AuthenticationContext } from "../../application/authentication-context.ts";
import type { LearningQueue } from "../../application/learning-queue.ts";
import type { LearningWriter } from "../../application/learning-writer.ts";

export async function handleLearningQueueRequest(
  request: Request,
  queue: LearningQueue,
  authentication: AuthenticationContext,
  trustedOrigin = new URL(request.url).origin,
): Promise<Response> {
  const json = responseJson;
  if (!(await authentication.getUserId()))
    return json({ error: "Authentication required." }, 401);
  if (new URL(request.url).search)
    return json({ error: "Unsupported query parameters." }, 400);
  if (request.method === "GET")
    return json({ queue: await queue.read(authentication) });
  if (request.method !== "PATCH") return methodNotAllowed("GET, PATCH");
  const invalid = validateMutationRequest(request, trustedOrigin);
  if (invalid) return invalid;
  const value = await readJson(request);
  if (
    !recordWith(value, ["itemId", "expectedVersion"]) ||
    typeof value.itemId !== "string" ||
    !uuid.test(value.itemId) ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 0
  )
    return json({ error: "Invalid queue position." }, 400);
  const result = await queue.select(
    authentication,
    value.itemId,
    value.expectedVersion,
  );
  if (result.status === "not-found")
    return json({ error: "Queue item not found.", queue: result.queue }, 404);
  return json(
    { queue: result.queue },
    result.status === "conflict" ? 409 : 200,
  );
}

export async function handleLearningPreferencesRequest(
  request: Request,
  writer: LearningWriter,
  authentication: AuthenticationContext,
  trustedOrigin = new URL(request.url).origin,
): Promise<Response> {
  if (!(await authentication.getUserId()))
    return responseJson({ error: "Authentication required." }, 401);
  if (new URL(request.url).search)
    return responseJson({ error: "Unsupported query parameters." }, 400);
  if (request.method === "GET")
    return responseJson({
      removalPolicy: await writer.getRemovalPolicy(authentication),
    });
  if (request.method !== "PATCH") return methodNotAllowed("GET, PATCH");
  const invalid = validateMutationRequest(request, trustedOrigin);
  if (invalid) return invalid;
  const value = await readJson(request);
  if (
    !recordWith(value, ["removalPolicy"]) ||
    (value.removalPolicy !== "archive" && value.removalPolicy !== "delete")
  )
    return responseJson({ error: "Invalid removal policy." }, 400);
  await writer.setRemovalPolicy(authentication, value.removalPolicy);
  return responseJson({ removalPolicy: value.removalPolicy });
}

const headers = { "cache-control": "private, no-store", vary: "Cookie" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function responseJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
}

function methodNotAllowed(allow: string) {
  return Response.json(
    { error: "Method not allowed." },
    { status: 405, headers: { ...headers, allow } },
  );
}

function validateMutationRequest(request: Request, trustedOrigin: string) {
  if (request.headers.get("origin") !== trustedOrigin)
    return responseJson({ error: "Invalid request origin." }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return responseJson({ error: "JSON content type required." }, 415);
  const length = request.headers.get("content-length");
  return length && (!/^\d+$/.test(length) || Number(length) > 2_000)
    ? responseJson({ error: "Request body is too large." }, 413)
    : null;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2_000) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
