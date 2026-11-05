import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";
import { validateDatabaseUrl } from "./src/infrastructure/config/environment";

loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/database/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: validateDatabaseUrl(process.env.DATABASE_URL) },
  strict: true,
  verbose: true,
});
