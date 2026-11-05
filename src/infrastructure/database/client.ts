import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { validateDatabaseUrl } from "../config/environment";

// Create once at the composition boundary; the owner must close it on shutdown.
// Constructing a pool does not connect or run queries during builds/imports.
export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString: validateDatabaseUrl(connectionString),
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    application_name: "mathaino",
  });

  return { db: drizzle(pool), close: () => pool.end() };
}
