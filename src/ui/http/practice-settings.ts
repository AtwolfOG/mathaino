import type { AuthenticationContext } from "../../application/authentication-context.ts";
import {
  InvalidPracticeSettingsError,
  isValidIanaTimeZone,
  type PracticeSettings,
} from "../../application/practice-settings.ts";

export async function handlePracticeSettingsRequest(
  request: Request,
  settings: PracticeSettings,
  authentication: AuthenticationContext,
  trustedOrigin = new URL(request.url).origin,
): Promise<Response> {
  if (!(await authentication.getUserId()))
    return responseJson({ error: "Authentication required." }, 401);
  if (new URL(request.url).search)
    return responseJson({ error: "Unsupported query parameters." }, 400);
  if (request.method === "GET")
    return responseJson(await settings.read(authentication));
  if (request.method !== "PATCH")
    return Response.json(
      { error: "Method not allowed." },
      { status: 405, headers: { ...headers, allow: "GET, PATCH" } },
    );
  if (request.headers.get("origin") !== trustedOrigin)
    return responseJson({ error: "Invalid request origin." }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return responseJson({ error: "JSON content type required." }, 415);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 2_000))
    return responseJson({ error: "Request body is too large." }, 413);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 2_000)
    return responseJson({ error: "Request body is too large." }, 413);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return responseJson({ error: "Invalid practice settings." }, 400);
  }
  if (
    !recordWith(value, ["masteryThreshold", "timeZone"]) ||
    typeof value.masteryThreshold !== "number" ||
    !Number.isSafeInteger(value.masteryThreshold) ||
    value.masteryThreshold < 1 ||
    value.masteryThreshold > 30 ||
    typeof value.timeZone !== "string" ||
    !isValidIanaTimeZone(value.timeZone)
  )
    return responseJson({ error: "Invalid practice settings." }, 400);
  try {
    return responseJson(
      await settings.update(authentication, {
        masteryThreshold: value.masteryThreshold,
        timeZone: value.timeZone,
      }),
    );
  } catch (error) {
    if (error instanceof InvalidPracticeSettingsError)
      return responseJson({ error: error.message }, 400);
    throw error;
  }
}

const headers = { "cache-control": "private, no-store", vary: "Cookie" };
function responseJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
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
