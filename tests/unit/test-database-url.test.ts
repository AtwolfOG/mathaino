import { expect, test } from "vitest";
import { getTestDatabaseUrl } from "../helpers/database-url";

test("an explicitly isolated connection URL is preserved", () => {
  const value =
    "postgresql://mathaino_test:local@127.0.0.1:54330/mathaino_test";
  expect(getTestDatabaseUrl(value)).toBe(value);
});

test.each([
  undefined,
  "postgresql://user:secret@127.0.0.1/mathaino",
  "postgresql://user:secret@production.example/mathaino_test",
  "postgresql://user:secret@127.0.0.1/mathaino_test?host=production.example",
  "postgresql://user:secret@127.0.0.1/mathaino_test?database=mathaino",
])("integration helpers refuse a non-isolated target (%s)", (value) => {
  expect(() => getTestDatabaseUrl(value)).toThrow("TEST_DATABASE_URL");
});
