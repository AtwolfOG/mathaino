import type { WhisperConfig } from "../transcription/whisper.ts";

export function readTranscriptionEnvironment(
  environment: Readonly<Record<string, unknown>>,
): WhisperConfig {
  const endpointValue = environment.TRANSCRIPTION_API_URL;
  if (typeof endpointValue !== "string" || !URL.canParse(endpointValue))
    throw new Error("TRANSCRIPTION_API_URL must be an explicit HTTPS URL.");
  const endpoint = new URL(endpointValue);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error(
      "TRANSCRIPTION_API_URL must use HTTPS and contain no credentials, query, or fragment.",
    );
  const apiKey = environment.TRANSCRIPTION_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0)
    throw new Error("TRANSCRIPTION_API_KEY is required.");
  const model = environment.TRANSCRIPTION_MODEL;
  if (typeof model !== "string" || model.trim().length === 0)
    throw new Error("TRANSCRIPTION_MODEL is required.");
  return { endpoint: endpoint.href, apiKey, model };
}
