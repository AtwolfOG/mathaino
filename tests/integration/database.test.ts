import { sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { createDatabase } from "@/infrastructure/database/client";
import { getTestDatabaseUrl } from "../helpers/database-url";

// Next.js enforces this compile-time boundary; this test runs in Node directly.
vi.mock("server-only", () => ({}));

test("Drizzle executes a read-only query on the dedicated PostgreSQL store", async () => {
  const connection = createDatabase(
    getTestDatabaseUrl(process.env.TEST_DATABASE_URL),
  );

  try {
    const result = await connection.db.execute(
      sql`select 1 as value, current_database() as database_name, current_user as role_name`,
    );

    expect(result.rows).toEqual([
      { value: 1, database_name: "mathaino_test", role_name: "mathaino_test" },
    ]);

    const privileges = await connection.db.execute(
      sql`select rolsuper from pg_roles where rolname = current_user`,
    );
    expect(privileges.rows).toEqual([{ rolsuper: false }]);
  } finally {
    await connection.close();
  }
});
