import nextEnv from "@next/env";
import { validateDatabaseUrl } from "../src/infrastructure/config/environment.ts";
import { createDatabase } from "../src/infrastructure/database/client.ts";
import { seedReferenceData } from "../src/infrastructure/database/seed.ts";

async function main() {
  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const connection = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  try {
    // No datasets are registered yet. In particular, this never reads bible/kjv/.
    const summary = await seedReferenceData(connection.db, {
      books: [],
      verses: [],
    });
    console.log(JSON.stringify(summary));
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Database seed failed.",
  );
  process.exitCode = 1;
});
