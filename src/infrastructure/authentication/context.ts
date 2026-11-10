import "server-only";
import type { AuthenticationContext } from "../../application/authentication-context.ts";
import type { AuthenticationService } from "./service.ts";

export function createAuthenticationContext(
  service: AuthenticationService,
  headers: Headers,
): AuthenticationContext {
  // Memoize only within this request, never across users or requests.
  let session: ReturnType<AuthenticationService["getSession"]> | undefined;
  const requestHeaders = new Headers(headers);
  return {
    getUserId: async () =>
      (await (session ??= service.getSession(requestHeaders)))?.user.id ?? null,
  };
}
