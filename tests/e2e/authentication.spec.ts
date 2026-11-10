import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";
import { getTestDatabaseUrl } from "../helpers/database-url";

const password = "Mathaino-browser-fixture-password-2026!";
const origin = "http://127.0.0.1:3100";

function userId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("user" in value) ||
    typeof value.user !== "object" ||
    value.user === null ||
    !("id" in value.user) ||
    typeof value.user.id !== "string"
  )
    throw new Error("Missing verified fixture user");
  return value.user.id;
}

test("registration, persistent login, logout, expiry and cross-user data protection work in the browser", async ({
  page,
  browser,
}) => {
  const emails = [
    `mathaino-e2e-${randomUUID()}@example.test`,
    `mathaino-e2e-${randomUUID()}@example.test`,
  ];
  const aliceEmail = emails[0];
  const bobEmail = emails[1];
  if (!aliceEmail || !bobEmail) throw new Error("Missing fixture emails");
  const owner = new Pool({
    connectionString: getTestDatabaseUrl(process.env.TEST_DATABASE_URL),
  });
  const auth = new Pool({
    connectionString: getTestDatabaseUrl(process.env.TEST_AUTH_DATABASE_URL),
  });
  const bob = await browser.newContext();
  try {
    await page.goto("/practice");
    await expect(page).toHaveURL(`${origin}/login`);
    await page.goto("/register");
    await page.getByLabel("Name", { exact: true }).fill("Alice");
    await page.getByLabel("Email", { exact: true }).fill(aliceEmail);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page).toHaveURL(`${origin}/login?registered=1`);
    await page.getByLabel("Email", { exact: true }).fill(aliceEmail);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Incorrect-fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page
        .getByRole("form", { name: "Sign in", exact: true })
        .getByRole("alert"),
    ).toHaveText("Email or password is incorrect.");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/practice`);
    const persistedPage = await page.reload();
    await expect(
      page.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();
    expect(persistedPage?.headers()["cache-control"]).toContain("no-store");
    const alice = userId(
      await (await page.request.get("/api/auth/get-session")).json(),
    );
    const cookie = (await page.context().cookies()).filter((value) =>
      value.name.includes("session_token"),
    );
    expect(cookie).toHaveLength(1);
    expect(cookie[0]?.httpOnly).toBe(true);
    expect(cookie[0]?.sameSite).toBe("Lax");
    await page.goto("/bible/genesis/1");
    await page
      .getByRole("checkbox", { name: "Select Genesis 1:1 for memorisation" })
      .check();
    await page
      .getByRole("checkbox", { name: "Select Genesis 1:2 for memorisation" })
      .check();
    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/learning-items") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Add 2 Verses" }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status()).toBe(200);
    await expect(page.getByRole("status")).toHaveText("2 verses added.");
    await page.reload();
    await page
      .getByRole("checkbox", { name: "Select Genesis 1:1 for memorisation" })
      .check();
    await page.getByRole("button", { name: "Add 1 Verse" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "0 verses added. 1 was already in your practice.",
    );
    await page.goto("/practice");
    await expect(
      page.getByRole("heading", { name: "Genesis 1:1" }),
    ).toBeVisible();
    await expect(
      page.getByText("In the beginning God created the heaven and the earth."),
    ).toBeHidden();
    await expect(page.getByText("1 of 2")).toBeVisible();
    await page.getByRole("button", { name: "Next verse" }).click();
    await expect(
      page.getByRole("heading", { name: "Genesis 1:2" }),
    ).toBeVisible();
    await page.goto("/bible/genesis/1");
    await page.goto("/practice");
    await expect(
      page.getByRole("heading", { name: "Genesis 1:2" }),
    ).toBeVisible();
    const connection = await owner.connect();
    let item: string;
    try {
      await connection.query("BEGIN");
      await connection.query(
        "select set_config('mathaino.user_id', $1, true)",
        [alice],
      );
      const result = await connection.query<{ id: string }>(
        "insert into learning_items (user_id, verse_id) select $1, id from bible_verses where translation_id = 'auth-e2e' returning id",
        [alice],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("Missing fixture item");
      item = id;
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
    await page.goto("/learning");
    await expect(
      page.getByText("Authentication ownership fixture."),
    ).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (await page.request.get(`/api/learning-items/${item}`)).status(),
    ).toBe(200);
    await bob.request.post(`${origin}/api/auth/sign-up/email`, {
      headers: { origin },
      data: { name: "Bob", email: bobEmail, password },
    });
    expect(
      (
        await bob.request.post(`${origin}/api/auth/sign-in/email`, {
          headers: { origin },
          data: { email: bobEmail, password },
        })
      ).status(),
    ).toBe(200);
    const bobId = userId(
      await (await bob.request.get(`${origin}/api/auth/get-session`)).json(),
    );
    const bobPage = await bob.newPage();
    await bobPage.goto(`${origin}/login?next=https%3A%2F%2Fevil.example`);
    await bobPage.getByLabel("Email", { exact: true }).fill(bobEmail);
    await bobPage.getByLabel("Password", { exact: true }).fill(password);
    await bobPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(bobPage).toHaveURL(`${origin}/practice`);
    expect(
      (await bob.request.get(`${origin}/api/learning-items/${item}`)).status(),
    ).toBe(404);
    expect(
      await (await bob.request.get(`${origin}/api/learning-items`)).json(),
    ).toEqual({ items: [] });
    expect(
      (await page.request.get(`/api/learning-items?userId=${bobId}`)).status(),
    ).toBe(400);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/login`);
    await page.goto("/practice");
    await expect(page).toHaveURL(`${origin}/login`);
    const replay = cookie
      .map((value) => `${value.name}=${value.value}`)
      .join("; ");
    expect(
      (
        await page.request.get("/api/learning-items", {
          headers: { cookie: replay },
        })
      ).status(),
    ).toBe(401);
    await auth.query(
      "update auth_sessions set created_at = '2020-01-01T00:00:00Z', expires_at = '2021-01-01T00:00:00Z' where user_id = $1",
      [bobId],
    );
    await bobPage.reload();
    await expect(bobPage).toHaveURL(`${origin}/login`);
    expect(
      (await bob.request.get(`${origin}/api/learning-items`)).status(),
    ).toBe(401);
  } finally {
    await bob.close();
    try {
      await auth.query("delete from users where email = any($1::text[])", [
        emails,
      ]);
    } finally {
      await owner.end();
      await auth.end();
    }
  }
});

test("unsafe redirects, forged origins and malformed requests cannot bypass auth", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login?next=https%3A%2F%2Fevil.example");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("login-mobile.png"),
    fullPage: true,
  });
  const wrongOrigin = await request.post("/api/auth/sign-out", {
    headers: { origin: "https://evil.example" },
    data: {},
  });
  expect(wrongOrigin.status()).toBe(403);
  const malformed = await request.post("/api/auth/sign-in/email", {
    headers: { origin, "content-type": "application/json" },
    data: "{broken",
  });
  expect(malformed.status()).toBe(400);
  const forged = await request.post("/api/auth/sign-in/email", {
    headers: { origin },
    data: {
      email: "fixture@example.test",
      password,
      callbackURL: "https://evil.example",
    },
  });
  expect(forged.status()).toBe(400);
  expect((await request.get("/api/learning-items")).status()).toBe(401);
});
