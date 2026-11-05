import { validateDatabaseUrl } from "@/infrastructure/config/environment";

export function getTestDatabaseUrl(value: unknown): string {
  const message =
    "TEST_DATABASE_URL must target a loopback host and a database ending in _test, without query overrides.";
  let connectionString: string;
  try {
    connectionString = validateDatabaseUrl(value);
  } catch {
    throw new Error(message);
  }

  const url = new URL(connectionString);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !url.pathname.endsWith("_test") ||
    url.search
  ) {
    throw new Error(message);
  }

  return connectionString;
}
