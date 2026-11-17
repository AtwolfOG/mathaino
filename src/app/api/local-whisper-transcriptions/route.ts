import { getLocalWhisperServices } from "@/composition/services";
import { createAuthenticationContext } from "@/infrastructure/authentication/context";
import { handleLocalWhisperTranscriptionRequest } from "@/ui/http/local-whisper-transcriptions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const services = await getLocalWhisperServices();
    if (!services.enabled) {
      return handleLocalWhisperTranscriptionRequest(request, undefined, {
        getUserId: async () => null,
      });
    }
    return handleLocalWhisperTranscriptionRequest(
      request,
      services.transcriber,
      createAuthenticationContext(services.auth, request.headers),
      services.authOrigin,
    );
  } catch {
    console.error("Local transcription unavailable.");
    return Response.json(
      { error: "Local transcription is unavailable." },
      {
        status: 502,
        headers: { "cache-control": "private, no-store", vary: "Cookie" },
      },
    );
  }
}
