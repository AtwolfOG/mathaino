import type { LearningReader } from "../../application/learning-reader.ts";
import type { LearningWriter } from "../../application/learning-writer.ts";
import type { AuthenticationContext } from "../../application/authentication-context.ts";

export async function handleLearningRequest(
  request: Request,
  reader: LearningReader,
  authentication: AuthenticationContext,
  id?: unknown,
  writer?: LearningWriter,
  trustedOrigin = new URL(request.url).origin,
) {
  const headers = { "cache-control": "private, no-store", vary: "Cookie" };
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers });
  if (!(await authentication.getUserId()))
    return json({ error: "Authentication required." }, 401);
  if (new URL(request.url).search)
    return json({ error: "Unsupported query parameters." }, 400);
  if (
    id !== undefined &&
    (typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      ))
  )
    return json({ error: "Invalid learning item identifier." }, 400);
  if (request.method === "GET") {
    if (id === undefined)
      return json({ items: await reader.list(authentication) });
    const item = await reader.find(authentication, id);
    return item
      ? json({ item })
      : json({ error: "Learning item not found." }, 404);
  }
  const collectionMutation = request.method === "POST" && id === undefined;
  const itemMutation =
    id !== undefined && ["DELETE", "PATCH"].includes(request.method);
  if (!collectionMutation && !itemMutation)
    return Response.json(
      { error: "Method not allowed." },
      {
        status: 405,
        headers: {
          ...headers,
          allow: id === undefined ? "GET, POST" : "GET, DELETE, PATCH",
        },
      },
    );
  const origin = request.headers.get("origin");
  if (origin !== trustedOrigin)
    return json({ error: "Invalid request origin." }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return json({ error: "JSON content type required." }, 415);
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > 20_000)
  )
    return json({ error: "Request body is too large." }, 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 20_000)
    return json({ error: "Request body is too large." }, 413);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return json({ error: "Invalid verse selection." }, 400);
  }
  if (!writer) throw new Error("Learning writer unavailable.");
  if (id !== undefined) {
    if (request.method === "DELETE") {
      const body = parseRemoval(value);
      if (!body) return json({ error: "Invalid removal request." }, 400);
      const removed = await writer.remove(authentication, id, body.policy);
      return removed
        ? json({ removed })
        : json({ error: "Learning item not found." }, 404);
    }
    if (!recordWith(value, ["archived"]) || value.archived !== false)
      return json({ error: "Invalid restore request." }, 400);
    const restored = await writer.restore(authentication, id);
    return restored
      ? json({ restored: true })
      : json({ error: "Learning item not found." }, 404);
  }
  const body = parseSelection(value);
  if (!body) return json({ error: "Invalid verse selection." }, 400);
  try {
    return json(await writer.add(authentication, body.references));
  } catch (error) {
    if (error instanceof Error && error.message === "Bible verse not found.")
      return json({ error: error.message }, 404);
    if (
      error instanceof Error &&
      ["Invalid Bible reference.", "Select at least one verse."].includes(
        error.message,
      )
    )
      return json({ error: error.message }, 400);
    throw error;
  }
}

function parseRemoval(
  value: unknown,
): { policy?: "archive" | "delete" } | null {
  if (recordWith(value, [])) return {};
  if (!recordWith(value, ["policy"])) return null;
  return value.policy === "archive" || value.policy === "delete"
    ? { policy: value.policy }
    : null;
}

function parseSelection(value: unknown) {
  if (!recordWith(value, ["references"]) || !Array.isArray(value.references))
    return null;
  if (!value.references.length) return null;
  const references = value.references.map((reference: unknown) => {
    if (!recordWith(reference, ["bookId", "chapterId", "verseNumber"]))
      return null;
    const { bookId, chapterId, verseNumber } = reference;
    if (
      typeof bookId !== "string" ||
      !/^[a-z0-9]+$/.test(bookId) ||
      typeof chapterId !== "string" ||
      !/^[1-9][0-9]*$/.test(chapterId) ||
      typeof verseNumber !== "string" ||
      !/^[1-9][0-9]*$/.test(verseNumber)
    )
      return null;
    return { bookId, chapterId, verseNumber };
  });
  return references.every((reference) => reference !== null)
    ? { references }
    : null;
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
