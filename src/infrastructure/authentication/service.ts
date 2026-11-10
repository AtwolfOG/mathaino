import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  users,
  authAccounts,
  authSessions,
  authVerifications,
  authRateLimits,
} from "../database/schema.ts";
import type { Database, DatabaseTransaction } from "../database/client.ts";
import type { AuthEnvironment } from "../config/auth-environment.ts";

export interface VerifiedSession {
  user: { id: string; email: string; name: string };
  expiresAt: Date;
}
export interface AuthenticationService {
  handler(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<VerifiedSession | null>;
}

export function createAuthentication(
  database: Database | DatabaseTransaction,
  config: AuthEnvironment,
): AuthenticationService {
  const auth = betterAuth({
    appName: "Mathaino",
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: [config.baseURL],
    database: drizzleAdapter(database, {
      provider: "pg",
      transaction: true,
      schema: {
        user: users,
        account: authAccounts,
        session: authSessions,
        verification: authVerifications,
        rateLimit: authRateLimits,
      },
    }),
    user: { fields: { name: "displayName" } },
    account: {
      fields: {
        providerId: "provider",
        accountId: "providerAccountId",
        password: "passwordHash",
      },
      accountLinking: { enabled: false },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 10 },
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: [] },
      useSecureCookies: config.secureCookies,
      cookiePrefix: "mathaino",
      cookies: {
        session_token: {
          name: config.secureCookies
            ? "__Host-mathaino.session_token"
            : "mathaino.session_token",
          attributes: {
            httpOnly: true,
            secure: config.secureCookies,
            sameSite: "lax",
            path: "/",
          },
        },
      },
    },
    logger: {
      level: "error",
      log: () => console.error("Authentication service operation failed."),
    },
    telemetry: { enabled: false },
  });
  return {
    handler: (request) => auth.handler(request),
    getSession: async (headers) => {
      const result = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true },
      });
      if (!result) return null;
      const { user, session } = result;
      if (
        typeof user.id !== "string" ||
        typeof user.email !== "string" ||
        typeof user.name !== "string"
      )
        return null;
      return {
        user: { id: user.id, email: user.email, name: user.name },
        expiresAt: session.expiresAt,
      };
    },
  };
}
