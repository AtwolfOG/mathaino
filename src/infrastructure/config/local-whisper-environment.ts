export type LocalWhisperConfig =
  { enabled: false } | { enabled: true; endpoint: string };

export function readLocalWhisperEnvironment(
  environment: Readonly<Record<string, unknown>>,
): LocalWhisperConfig {
  if (environment.NODE_ENV !== "development") return { enabled: false };

  const enabled = environment.LOCAL_WHISPER_ENABLED ?? "false";
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("LOCAL_WHISPER_ENABLED must be either true or false.");
  }
  if (enabled === "false") return { enabled: false };

  const value = environment.LOCAL_WHISPER_URL ?? "http://127.0.0.1:8080";
  if (typeof value !== "string" || !URL.canParse(value)) {
    throw new Error("LOCAL_WHISPER_URL must be an explicit HTTP loopback URL.");
  }
  const url = new URL(value);
  if (url.protocol !== "http:")
    throw new Error("LOCAL_WHISPER_URL must use HTTP.");
  if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]")
    throw new Error(
      "LOCAL_WHISPER_URL must use the loopback IP 127.0.0.1 or [::1].",
    );
  if (!url.port)
    throw new Error("LOCAL_WHISPER_URL must include an explicit port.");
  if (url.username || url.password)
    throw new Error("LOCAL_WHISPER_URL must not contain credentials.");
  if (url.search)
    throw new Error("LOCAL_WHISPER_URL must not contain a query.");
  if (url.hash)
    throw new Error("LOCAL_WHISPER_URL must not contain a fragment.");
  const literal = /^http:\/\/(127\.0\.0\.1|\[::1\]):(\d+)(?:\/[^?#]*)?$/.exec(
    value,
  );
  if (!literal)
    throw new Error(
      "LOCAL_WHISPER_URL must use an exact loopback IP and explicit port.",
    );

  return {
    enabled: true,
    endpoint: new URL(`http://${literal[1]}:${literal[2]}/inference`).href,
  };
}
