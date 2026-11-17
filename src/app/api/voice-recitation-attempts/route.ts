import { getVoiceServices } from "@/composition/services";
import { createAuthenticationContext } from "@/infrastructure/authentication/context";
import { handleVoiceRecitationRequest } from "@/ui/http/voice-recitation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const services = await getVoiceServices();
    return handleVoiceRecitationRequest(
      request,
      services.voiceRecitation,
      createAuthenticationContext(services.auth, request.headers),
      services.authOrigin,
    );
  } catch {
    console.error("Voice recitation unavailable.");
    return Response.json(
      {
        error:
          "Voice recitation is temporarily unavailable. Type your recitation or try again later.",
      },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
