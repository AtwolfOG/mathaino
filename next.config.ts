import type { NextConfig } from "next";
import { validateDatabaseUrl } from "./src/infrastructure/config/environment.ts";

// Liveness and static builds need no database; validate any configured URL early.
if (process.env.DATABASE_URL !== undefined) {
  validateDatabaseUrl(process.env.DATABASE_URL);
}

const nextConfig: NextConfig = {};

export default nextConfig;
