import { getServices } from "@/composition/services";
import { handleAuthenticationRequest } from "@/infrastructure/authentication/http";

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  try {
    const services = await getServices();
    return await handleAuthenticationRequest(
      services.auth,
      request,
      services.authOrigin,
    );
  } catch {
    console.error(
      "Authentication request unavailable; check server configuration and database health.",
    );
    return Response.json(
      { error: "Authentication is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export { handle as GET, handle as POST };
