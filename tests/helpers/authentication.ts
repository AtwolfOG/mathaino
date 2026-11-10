import { TransactionRollbackError } from "drizzle-orm";
import {
  createDatabase,
  type DatabaseTransaction,
} from "@/infrastructure/database/client";
import { applyMigrations } from "@/infrastructure/database/migrate";
import {
  createAuthentication,
  type AuthenticationService,
} from "@/infrastructure/authentication/service";
import { readAuthEnvironment } from "@/infrastructure/config/auth-environment";
import { getTestDatabaseUrl } from "./database-url";

export const authOrigin = "https://mathaino.example";
export const fixturePassword = "Mathaino-fixture-password-2026!";
export const fixtureSecret =
  "test-only-auth-secret-not-for-deployment-0123456789";

export function authTestEnvironment() {
  const databaseURL = getTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const authDatabaseURL = getTestDatabaseUrl(
    process.env.TEST_AUTH_DATABASE_URL,
  );
  return readAuthEnvironment({
    DATABASE_URL: databaseURL,
    AUTH_DATABASE_URL: authDatabaseURL,
    BETTER_AUTH_SECRET: fixtureSecret,
    BETTER_AUTH_URL: authOrigin,
  });
}

export async function withAuthenticationTest(
  run: (
    service: AuthenticationService,
    transaction: DatabaseTransaction,
  ) => Promise<void>,
) {
  const config = authTestEnvironment();
  const owner = createDatabase(config.databaseURL);
  const connection = createDatabase(config.authDatabaseURL);
  try {
    await applyMigrations(owner.db);
    let finished = false;
    try {
      await connection.db.transaction(async (tx) => {
        await run(createAuthentication(tx, config), tx);
        finished = true;
        tx.rollback();
      });
    } catch (error) {
      if (!finished || !(error instanceof TransactionRollbackError))
        throw error;
    }
  } finally {
    await connection.close();
    await owner.close();
  }
}

export function authRequest(path: string, body?: unknown, cookie?: string) {
  return new Request(`${authOrigin}/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: authOrigin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function cookieHeader(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export async function register(
  service: AuthenticationService,
  email = "alice@mathaino.test",
) {
  const response = await service.handler(
    authRequest("sign-up/email", {
      name: "Fixture learner",
      email,
      password: fixturePassword,
    }),
  );
  if (response.status !== 200)
    throw new Error(
      `Fixture registration failed (${response.status}): ${await response.text()}`,
    );
  return response;
}

export async function login(
  service: AuthenticationService,
  email = "alice@mathaino.test",
  password = fixturePassword,
) {
  return service.handler(
    authRequest("sign-in/email", { email, password, rememberMe: true }),
  );
}
