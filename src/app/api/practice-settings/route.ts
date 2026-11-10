import { getServices } from "@/composition/services";
import { createAuthenticationContext } from "@/infrastructure/authentication/context";
import { handlePracticeSettingsRequest } from "@/ui/http/practice-settings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const services = await getServices();
    return handlePracticeSettingsRequest(
      request,
      services.practiceSettings,
      createAuthenticationContext(services.auth, request.headers),
      services.authOrigin,
    );
  } catch {
    console.error("Practice settings request unavailable.");
    return Response.json(
      { error: "Practice settings are temporarily unavailable." },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}

export const PATCH = GET;
