import nextEnv from "@next/env";
import { validateDatabaseUrl } from "../src/infrastructure/config/environment.ts";
import { createDatabase } from "../src/infrastructure/database/client.ts";
import { applyMigrations } from "../src/infrastructure/database/migrate.ts";

async function main() {
  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const connection = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  try {
    await applyMigrations(connection.db);
    console.log("Database migrations complete.");
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Database migration failed.",
  );
  process.exitCode = 1;
});
