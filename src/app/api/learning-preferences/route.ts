import { getServices } from "@/composition/services";
import { createAuthenticationContext } from "@/infrastructure/authentication/context";
import { handleLearningPreferencesRequest } from "@/ui/http/learning-queue";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const services = await getServices();
    return handleLearningPreferencesRequest(
      request,
      services.learningWriter,
      createAuthenticationContext(services.auth, request.headers),
      services.authOrigin,
    );
  } catch {
    console.error("Learning preferences request unavailable.");
    return Response.json(
      { error: "Learning preferences are temporarily unavailable." },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}

export const PATCH = GET;
