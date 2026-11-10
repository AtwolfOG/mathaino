import { defineConfig, devices } from "@playwright/test";
import { getTestDatabaseUrl } from "./tests/helpers/database-url.ts";
import { readAuthEnvironment } from "./src/infrastructure/config/auth-environment.ts";
import { e2eAuthSecret } from "./tests/helpers/auth-constants.ts";

const baseURL = "http://127.0.0.1:3100";
const databaseURL = getTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const authDatabaseURL = getTestDatabaseUrl(process.env.TEST_AUTH_DATABASE_URL);
readAuthEnvironment({
  DATABASE_URL: databaseURL,
  AUTH_DATABASE_URL: authDatabaseURL,
  BETTER_AUTH_URL: baseURL,
  BETTER_AUTH_SECRET: e2eAuthSecret,
});
if (new URL(databaseURL).pathname !== "/mathaino_auth_e2e_test")
  throw new Error(
    "Use the dedicated mathaino_auth_e2e_test database for browser tests.",
  );

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "node --conditions=react-server scripts/prepare-auth-e2e.mts && npm run build && npm run start -- --hostname 127.0.0.1 --port 3100",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: databaseURL,
      AUTH_DATABASE_URL: authDatabaseURL,
      TEST_DATABASE_URL: databaseURL,
      TEST_AUTH_DATABASE_URL: authDatabaseURL,
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: e2eAuthSecret,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
