import { describe, expect, test } from "vitest";
import { validateDatabaseUrl } from "@/infrastructure/config/environment";

describe("PostgreSQL environment configuration", () => {
  test.each([
    "postgres://user:password@127.0.0.1:54329/mathaino",
    "postgresql://user:p%40ss@db.example/mathaino?sslmode=verify-full",
  ])("preserves a valid PostgreSQL URL (%s)", (value) => {
    expect(validateDatabaseUrl(value)).toBe(value);
  });

  test.each([
    undefined,
    null,
    5432,
    {},
    "",
    "   ",
    "not-a-url",
    "https://user:secret@localhost/mathaino",
    "postgresql:///mathaino",
    "postgresql://localhost",
    "postgresql://localhost/",
    "postgresql://localhost:70000/mathaino",
    " postgresql://localhost/mathaino",
    "postgresql://localhost/mathaino#fragment",
  ])(
    "rejects invalid or missing configuration (%j) without echoing secrets",
    (value) => {
      expect(() => validateDatabaseUrl(value)).toThrow(
        "DATABASE_URL must be a PostgreSQL URL with a host and database name.",
      );
    },
  );
});
