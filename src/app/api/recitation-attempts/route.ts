import { getServices } from "@/composition/services";
import { createAuthenticationContext } from "@/infrastructure/authentication/context";
import { handleRecitationRequest } from "@/ui/http/recitation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const services = await getServices();
    return handleRecitationRequest(
      request,
      services.recitation,
      createAuthenticationContext(services.auth, request.headers),
      services.authOrigin,
    );
  } catch {
    console.error("Recitation submission unavailable.");
    return Response.json(
      {
        error:
          "Recitation could not be saved. Try again with the same attempt.",
      },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
