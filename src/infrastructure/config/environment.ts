export function validateDatabaseUrl(value: unknown): string {
  const message =
    "DATABASE_URL must be a PostgreSQL URL with a host and database name.";

  if (typeof value !== "string" || /\s/.test(value) || !URL.canParse(value)) {
    throw new Error(message);
  }

  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length <= 1 ||
    url.hash
  ) {
    throw new Error(message);
  }

  return value;
}
