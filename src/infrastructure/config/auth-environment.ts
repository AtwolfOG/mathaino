export interface AuthEnvironment {
  baseURL: string;
  secret: string;
  databaseURL: string;
  authDatabaseURL: string;
  secureCookies: boolean;
}

export function readAuthEnvironment(
  environment: Readonly<Record<string, unknown>>,
): AuthEnvironment {
  const secret = environment.BETTER_AUTH_SECRET;
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    secret.trim() !== secret
  )
    throw new Error(
      "BETTER_AUTH_SECRET must contain at least 32 characters of generated secret material.",
    );
  const baseURL = environment.BETTER_AUTH_URL;
  if (typeof baseURL !== "string" || !URL.canParse(baseURL))
    throw new Error("BETTER_AUTH_URL must be an explicit application origin.");
  const origin = new URL(baseURL);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  ) {
    throw new Error(
      "BETTER_AUTH_URL must use HTTPS, except for loopback development, and contain no path or credentials.",
    );
  }
  const databaseURL = validateDatabaseUrl(environment.DATABASE_URL);
  let authDatabaseURL: string;
  try {
    authDatabaseURL = validateDatabaseUrl(environment.AUTH_DATABASE_URL);
  } catch {
    throw new Error(
      "AUTH_DATABASE_URL must be a valid dedicated authentication connection.",
    );
  }
  const app = new URL(databaseURL);
  const auth = new URL(authDatabaseURL);
  const overrides = new Set([
    "user",
    "username",
    "password",
    "host",
    "hostaddr",
    "port",
    "database",
    "dbname",
    "options",
    "connectionstring",
  ]);
  if (
    [...app.searchParams.keys(), ...auth.searchParams.keys()].some((key) =>
      overrides.has(key.toLowerCase()),
    )
  )
    throw new Error(
      "Database URLs must not override their role, host, database or session context through query parameters.",
    );
  if (
    auth.username !== "mathaino_auth" ||
    app.username === auth.username ||
    app.hostname !== auth.hostname ||
    (app.port || "5432") !== (auth.port || "5432") ||
    app.pathname !== auth.pathname
  ) {
    throw new Error(
      "Authentication must use the separate mathaino_auth role in the application database.",
    );
  }
  return {
    baseURL: origin.origin,
    secret,
    databaseURL,
    authDatabaseURL,
    secureCookies: origin.protocol === "https:",
  };
}
import { validateDatabaseUrl } from "./environment.ts";
