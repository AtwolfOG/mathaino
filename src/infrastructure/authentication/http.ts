import "server-only";
import type { AuthenticationService } from "./service.ts";

export async function handleAuthenticationRequest(
  service: AuthenticationService,
  request: Request,
  origin: string,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice("/api/auth/".length);
  const routes = new Map([
    ["sign-up/email", "POST"],
    ["sign-in/email", "POST"],
    ["sign-out", "POST"],
    ["get-session", "GET"],
  ]);
  const method = routes.get(path);
  if (!method || !url.pathname.startsWith("/api/auth/"))
    return json({ error: "Not found." }, 404);
  if (request.method !== method)
    return json({ error: "Method not allowed." }, 405);
  if (url.search)
    return json({ error: "Unsupported authentication parameters." }, 400);
  const requestOrigin = request.headers.get("origin");
  if (
    (request.method === "POST" && requestOrigin !== origin) ||
    (requestOrigin !== null && requestOrigin !== origin)
  )
    return json({ error: "Untrusted request origin." }, 403);
  if (request.method === "GET") {
    // Retain the library's HTTP throttling and expired-cookie cleanup, while
    // exposing only the public session projection below.
    return publicResponse(await service.handler(request), true);
  }
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return json({ error: "Use a JSON request body." }, 415);
  let value: unknown;
  try {
    value = await limitedJson(request);
  } catch (error) {
    return json(
      { error: "Invalid authentication request." },
      error instanceof BodyTooLarge ? 413 : 400,
    );
  }
  if (!isRecord(value))
    return json({ error: "Invalid authentication request." }, 400);
  const allowed =
    path === "sign-up/email"
      ? ["name", "email", "password"]
      : path === "sign-in/email"
        ? ["email", "password", "rememberMe"]
        : [];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    return json({ error: "Unsupported authentication field." }, 400);
  if (path !== "sign-out") {
    if (
      typeof value.email !== "string" ||
      !value.email.isWellFormed() ||
      value.email.trim().length === 0 ||
      value.email.length > 254 ||
      typeof value.password !== "string" ||
      !value.password.isWellFormed() ||
      value.password.length < 12 ||
      value.password.length > 128 ||
      (value.rememberMe !== undefined && typeof value.rememberMe !== "boolean")
    )
      return json({ error: "Check your authentication details." }, 400);
    value.email = value.email.trim().toLowerCase();
    if (path === "sign-up/email") {
      if (
        typeof value.name !== "string" ||
        !value.name.isWellFormed() ||
        [...value.name].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        !value.name.trim() ||
        value.name.length > 100
      )
        return json({ error: "Check your name." }, 400);
      value.name = value.name.trim();
    }
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const response = await service.handler(
    new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(value),
    }),
  );
  return publicResponse(response, false);
}

async function publicResponse(response: Response, sessionRead: boolean) {
  const outputHeaders = new Headers({ "cache-control": "no-store" });
  for (const cookie of response.headers.getSetCookie())
    outputHeaders.append("set-cookie", cookie);
  const retry = response.headers.get("x-retry-after");
  if (retry) outputHeaders.set("retry-after", retry);
  if (response.ok) {
    if (!sessionRead)
      return Response.json({ ok: true }, { headers: outputHeaders });
    const value: unknown = await response.json();
    if (value === null)
      return Response.json({ user: null }, { headers: outputHeaders });
    if (
      isRecord(value) &&
      isRecord(value.user) &&
      isRecord(value.session) &&
      typeof value.user.id === "string" &&
      typeof value.user.email === "string" &&
      typeof value.user.name === "string" &&
      typeof value.session.expiresAt === "string" &&
      Number.isFinite(Date.parse(value.session.expiresAt))
    ) {
      return Response.json(
        {
          user: {
            id: value.user.id,
            email: value.user.email,
            name: value.user.name,
          },
          expiresAt: value.session.expiresAt,
        },
        { headers: outputHeaders },
      );
    }
    return Response.json(
      { error: "Authentication is temporarily unavailable." },
      { status: 503, headers: outputHeaders },
    );
  }
  const error =
    response.status === 401
      ? "Email or password is incorrect."
      : response.status === 429
        ? "Too many attempts. Try again shortly."
        : response.status >= 500
          ? "Authentication is temporarily unavailable."
          : "Check your authentication details.";
  return Response.json(
    { error },
    { status: response.status, headers: outputHeaders },
  );
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
class BodyTooLarge extends Error {}
async function limitedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  return value;
}
