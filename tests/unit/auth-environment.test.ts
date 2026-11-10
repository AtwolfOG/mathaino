import { expect, test } from "vitest";
import { readAuthEnvironment } from "@/infrastructure/config/auth-environment";

export const validAuthEnvironment = {
  BETTER_AUTH_URL: "https://mathaino.example",
  BETTER_AUTH_SECRET: "test-only-auth-secret-not-for-deployment-0123456789",
  DATABASE_URL: "postgresql://app:fixture@127.0.0.1:54330/mathaino_test",
  AUTH_DATABASE_URL:
    "postgresql://mathaino_auth:fixture@127.0.0.1:54330/mathaino_test",
};

test("auth configuration requires an explicit origin, strong secret and separate co-located auth role", () => {
  expect(readAuthEnvironment(validAuthEnvironment)).toMatchObject({
    baseURL: validAuthEnvironment.BETTER_AUTH_URL,
    secureCookies: true,
  });
});

test.each([
  { BETTER_AUTH_SECRET: undefined },
  { BETTER_AUTH_SECRET: "short" },
  { BETTER_AUTH_URL: "http://mathaino.example" },
  { BETTER_AUTH_URL: "https://user:password@mathaino.example" },
  { BETTER_AUTH_URL: "https://mathaino.example/unsafe/path" },
  { BETTER_AUTH_URL: "https://mathaino.example?callback=https://evil.example" },
  {
    AUTH_DATABASE_URL: "postgresql://app:fixture@127.0.0.1:54330/mathaino_test",
  },
  {
    AUTH_DATABASE_URL:
      "postgresql://mathaino_auth:fixture@127.0.0.1:54329/mathaino",
  },
  {
    AUTH_DATABASE_URL:
      "postgresql://mathaino_auth:fixture@127.0.0.1:54330/mathaino_test?user=postgres",
  },
  {
    AUTH_DATABASE_URL:
      "postgresql://mathaino_auth:fixture@127.0.0.1:54330/mathaino_test?host=other.example",
  },
])(
  "unsafe authentication configuration fails without echoing credentials (%j)",
  (override) => {
    expect(() =>
      readAuthEnvironment({ ...validAuthEnvironment, ...override }),
    ).toThrow();
  },
);

test("HTTP is permitted only for explicit loopback development/test origins", () => {
  expect(
    readAuthEnvironment({
      ...validAuthEnvironment,
      BETTER_AUTH_URL: "http://127.0.0.1:3100",
    }),
  ).toMatchObject({ secureCookies: false, baseURL: "http://127.0.0.1:3100" });
});
