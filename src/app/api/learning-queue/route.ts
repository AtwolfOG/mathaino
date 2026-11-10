import { getServices } from "@/composition/services";
import { createAuthenticationContext } from "@/infrastructure/authentication/context";
import { handleLearningQueueRequest } from "@/ui/http/learning-queue";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const services = await getServices();
    return handleLearningQueueRequest(
      request,
      services.learningQueue,
      createAuthenticationContext(services.auth, request.headers),
      services.authOrigin,
    );
  } catch {
    console.error("Learning queue request unavailable.");
    return Response.json(
      { error: "Learning queue is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}

export const PATCH = GET;
