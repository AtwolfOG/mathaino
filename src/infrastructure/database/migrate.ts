import "server-only";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client.ts";

export function applyMigrations(database: Database) {
  return migrate(database, {
    migrationsFolder: fileURLToPath(
      new URL("../../../drizzle", import.meta.url),
    ),
  });
}
