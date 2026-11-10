import { expect, test } from "vitest";
import { handleAuthenticationRequest } from "@/infrastructure/authentication/http";
import {
  authOrigin,
  authRequest,
  cookieHeader,
  fixturePassword,
  withAuthenticationTest,
} from "../helpers/authentication";

test("public registration/login responses do not expose session tokens or account records", () =>
  withAuthenticationTest(async (service) => {
    const signup = await handleAuthenticationRequest(
      service,
      authRequest("sign-up/email", {
        name: "Alice",
        email: "alice@mathaino.test",
        password: fixturePassword,
      }),
      authOrigin,
    );
    expect(signup.status).toBe(200);
    expect(await signup.json()).toEqual({ ok: true });
    const login = await handleAuthenticationRequest(
      service,
      authRequest("sign-in/email", {
        email: "alice@mathaino.test",
        password: fixturePassword,
      }),
      authOrigin,
    );
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ ok: true });
    const session = await handleAuthenticationRequest(
      service,
      authRequest("get-session", undefined, cookieHeader(login)),
      authOrigin,
    );
    expect(await session.json()).toMatchObject({
      user: { email: "alice@mathaino.test" },
    });
    expect(session.headers.get("cache-control")).toBe("no-store");
  }));

test("duplicate registration is indistinguishable from successful registration", () =>
  withAuthenticationTest(async (service) => {
    const request = () =>
      authRequest("sign-up/email", {
        name: "Alice",
        email: "alice@mathaino.test",
        password: fixturePassword,
      });
    const first = await handleAuthenticationRequest(
      service,
      request(),
      authOrigin,
    );
    const second = await handleAuthenticationRequest(
      service,
      request(),
      authOrigin,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
  }));

test.each([
  { body: "{ malformed", contentType: "application/json", status: 400 },
  { body: "[]", contentType: "application/json", status: 400 },
  {
    body: JSON.stringify({ email: "not-email", password: fixturePassword }),
    contentType: "application/json",
    status: 400,
  },
  {
    body: JSON.stringify({ email: "alice@mathaino.test", password: "short" }),
    contentType: "application/json",
    status: 400,
  },
  {
    body: JSON.stringify({
      email: "alice@mathaino.test",
      password: "\ud800".repeat(12),
    }),
    contentType: "application/json",
    status: 400,
  },
  {
    body: JSON.stringify({
      email: "alice@mathaino.test",
      password: fixturePassword,
      userId: "forged-owner",
    }),
    contentType: "application/json",
    status: 400,
  },
  {
    body: JSON.stringify({
      email: "alice@mathaino.test",
      password: fixturePassword,
      callbackURL: "https://evil.example",
    }),
    contentType: "application/json",
    status: 400,
  },
  { body: "x".repeat(20000), contentType: "application/json", status: 413 },
  {
    body: "email=x&password=y",
    contentType: "application/x-www-form-urlencoded",
    status: 415,
  },
])(
  "malformed auth input returns $status ($contentType)",
  ({ body, contentType, status }) =>
    withAuthenticationTest(async (service) => {
      const request = new Request(`${authOrigin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin: authOrigin, "content-type": contentType },
        body,
      });
      expect(
        (await handleAuthenticationRequest(service, request, authOrigin))
          .status,
      ).toBe(status);
    }),
);

test("cross-origin and origin-less mutations fail closed; unsupported auth paths stay unavailable", () =>
  withAuthenticationTest(async (service) => {
    for (const origin of [null, "https://evil.example", "null"]) {
      const headers = new Headers({ "content-type": "application/json" });
      if (origin) headers.set("origin", origin);
      const request = new Request(`${authOrigin}/api/auth/sign-out`, {
        method: "POST",
        headers,
        body: "{}",
      });
      expect(
        (await handleAuthenticationRequest(service, request, authOrigin))
          .status,
      ).toBe(403);
    }
    expect(
      (
        await handleAuthenticationRequest(
          service,
          authRequest("list-sessions"),
          authOrigin,
        )
      ).status,
    ).toBe(404);
  }));

test("registration rejects control characters in names before hitting persistence", () =>
  withAuthenticationTest(async (service) => {
    const response = await handleAuthenticationRequest(
      service,
      authRequest("sign-up/email", {
        name: "\0",
        email: "fixture@mathaino.test",
        password: fixturePassword,
      }),
      authOrigin,
    );
    expect(response.status).toBe(400);
  }));

test("the maintained library rate limiter bounds repeated sign-in attempts", () =>
  withAuthenticationTest(async (service) => {
    let last: Response | undefined;
    for (let i = 0; i < 11; i++)
      last = await handleAuthenticationRequest(
        service,
        authRequest("sign-in/email", {
          email: "missing@mathaino.test",
          password: fixturePassword,
        }),
        authOrigin,
      );
    expect(last?.status).toBe(429);
  }));

test("public session reads retain the library's HTTP rate limiting", () =>
  withAuthenticationTest(async (service) => {
    let last: Response | undefined;
    for (let i = 0; i < 61; i++) {
      last = await handleAuthenticationRequest(
        service,
        authRequest("get-session"),
        authOrigin,
      );
    }
    expect(last?.status).toBe(429);
  }));
