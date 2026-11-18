import { getServices } from "@/composition/services";
import { createAuthenticationContext } from "@/infrastructure/authentication/context";
import { handleReviewRequest } from "@/ui/http/review";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const services = await getServices();
    return handleReviewRequest(
      request,
      services.review,
      createAuthenticationContext(services.auth, request.headers),
      services.authOrigin,
    );
  } catch {
    console.error("Review submission unavailable.");
    return Response.json(
      {
        error: "Review could not be saved. Try again with the same attempt.",
      },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
