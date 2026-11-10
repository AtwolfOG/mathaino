import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { getTestDatabaseUrl } from "../helpers/database-url";
import { withTestDatabase } from "../helpers/schema-database";

function command(
  name: "migrate" | "seed",
  url = getTestDatabaseUrl(process.env.TEST_DATABASE_URL),
) {
  return spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      fileURLToPath(new URL(`../../scripts/${name}.mts`, import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, NODE_ENV: "test", DATABASE_URL: url },
      encoding: "utf8",
      timeout: 10000,
    },
  );
}

test("the migration command can be rerun without duplicating applied migrations", () =>
  withTestDatabase(async (db) => {
    const before = (
      await db.execute(
        sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
      )
    ).rows;
    for (let i = 0; i < 2; i++) {
      const result = command("migrate");
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    }
    expect(
      (
        await db.execute(
          sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
        )
      ).rows,
    ).toEqual(before);
  }));

test("the seed command is an explicit empty seed with no Bible import", () =>
  withTestDatabase(async (db) => {
    const result = command("seed");
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const summary: unknown = JSON.parse(result.stdout);
    expect(summary).toEqual({ booksInserted: 0, versesInserted: 0 });
    expect((await db.execute(sql`select id from bible_books`)).rows).toEqual(
      [],
    );
  }));

test.each(["migrate", "seed"] as const)(
  "%s rejects missing configuration instead of using an implicit database",
  (name) => {
    const result = command(name, "");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL must be a PostgreSQL URL");
  },
);
