import { getServices } from "@/composition/services";
import { createAuthenticationContext } from "@/infrastructure/authentication/context";
import { handleLearningRequest } from "@/ui/http/learning";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const services = await getServices();
    return await handleLearningRequest(
      request,
      services.learning,
      createAuthenticationContext(services.auth, request.headers),
      undefined,
      services.learningWriter,
      services.authOrigin,
    );
  } catch {
    console.error("Protected learning request unavailable.");
    return Response.json(
      { error: "Learning data is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}

export const POST = GET;
