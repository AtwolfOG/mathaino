import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { createAuthentication } from "@/infrastructure/authentication/service";
import { expectDatabaseError } from "../helpers/schema-database";
import {
  authOrigin,
  authRequest,
  authTestEnvironment,
  cookieHeader,
  fixturePassword,
  login,
  register,
  withAuthenticationTest,
} from "../helpers/authentication";

test("registration persists a normalized identity and library password hash without creating a session", () =>
  withAuthenticationTest(async (service, db) => {
    const response = await register(service, "Alice@mathaino.test");
    expect(response.status).toBe(200);
    expect(cookieHeader(response)).not.toContain("session_token");
    const users = await db.execute(
      sql`select email, email_verified from users`,
    );
    expect(users.rows).toEqual([
      { email: "alice@mathaino.test", email_verified: false },
    ]);
    const accounts = await db.execute(
      sql`select password_hash from auth_accounts`,
    );
    expect(accounts.rows[0]?.password_hash).toEqual(expect.any(String));
    expect(accounts.rows[0]?.password_hash).not.toBe(fixturePassword);
    expect((await db.execute(sql`select id from auth_sessions`)).rows).toEqual(
      [],
    );
  }));

test("login issues a host-only secure HttpOnly SameSite cookie and persists across service instances", () =>
  withAuthenticationTest(async (service, db) => {
    await register(service);
    const response = await login(service);
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie().join("; ");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("SameSite=Lax");
    expect(cookies).toContain("Path=/");
    expect(cookies).not.toContain("Domain=");
    const cookie = cookieHeader(response);
    const session = await createAuthentication(
      db,
      authTestEnvironment(),
    ).getSession(new Headers({ cookie }));
    expect(session?.user.email).toBe("alice@mathaino.test");
    expect(
      (await db.execute(sql`select token, token_hash from auth_sessions`)).rows,
    ).toEqual([{ token: expect.any(String), token_hash: null }]);
  }));

test("wrong passwords and unknown emails return the same invalid-credentials response", () =>
  withAuthenticationTest(async (service) => {
    await register(service);
    const wrong = await login(
      service,
      "alice@mathaino.test",
      "incorrect-fixture-password",
    );
    const unknown = await login(
      service,
      "missing@mathaino.test",
      "incorrect-fixture-password",
    );
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  }));

test("logout revokes the persisted session, clears its cookie, and prevents replay", () =>
  withAuthenticationTest(async (service, db) => {
    await register(service);
    const signedIn = await login(service);
    const cookie = cookieHeader(signedIn);
    const response = await service.handler(authRequest("sign-out", {}, cookie));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join("; ")).toContain("Max-Age=0");
    expect(await service.getSession(new Headers({ cookie }))).toBeNull();
    expect((await db.execute(sql`select id from auth_sessions`)).rows).toEqual(
      [],
    );
  }));

test("expired sessions and tampered cookies cannot authenticate", () =>
  withAuthenticationTest(async (service, db) => {
    await register(service);
    const response = await login(service);
    const cookie = cookieHeader(response);
    expect(
      await service.getSession(new Headers({ cookie: `${cookie}tampered` })),
    ).toBeNull();
    await db.execute(
      sql`update auth_sessions set created_at = '2020-01-01T00:00:00Z', expires_at = '2021-01-01T00:00:00Z'`,
    );
    expect(await service.getSession(new Headers({ cookie }))).toBeNull();
  }));

test("the authentication database role cannot access learning data even with a forged SQL owner context", () =>
  withAuthenticationTest(async (service, db) => {
    await register(service);
    for (const table of [
      "learning_items",
      "learning_preferences",
      "practice_attempts",
      "daily_practice_completions",
      "review_schedules",
    ]) {
      await expectDatabaseError(
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select set_config('mathaino.user_id', '00000000-0000-4000-8000-000000000001', true)`,
          );
          await tx.execute(sql`select * from ${sql.identifier(table)}`);
        }),
        "42501",
      );
    }
    expect(new URL(authOrigin).protocol).toBe("https:");
  }));
