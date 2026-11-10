import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";
import { getTestDatabaseUrl } from "../helpers/database-url";

const password = "Mathaino-recitation-browser-password-2026!";
const origin = "http://127.0.0.1:3100";

function sessionUserId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("user" in value) ||
    typeof value.user !== "object" ||
    value.user === null ||
    !("id" in value.user) ||
    typeof value.user.id !== "string"
  )
    throw new Error("Missing browser fixture user.");
  return value.user.id;
}

test("typed recitation works by keyboard and mobile while attempts remain owner-scoped", async ({
  page,
  browser,
}) => {
  const emails = [
    `recitation-e2e-${randomUUID()}@example.test`,
    `recitation-e2e-${randomUUID()}@example.test`,
  ];
  const aliceEmail = emails[0];
  const bobEmail = emails[1];
  if (!aliceEmail || !bobEmail) throw new Error("Missing fixture emails.");
  const owner = new Pool({
    connectionString: getTestDatabaseUrl(process.env.TEST_DATABASE_URL),
  });
  const authentication = new Pool({
    connectionString: getTestDatabaseUrl(process.env.TEST_AUTH_DATABASE_URL),
  });
  const bob = await browser.newContext();
  try {
    expect(
      (
        await page.request.post("/api/auth/sign-up/email", {
          headers: { origin },
          data: { name: "Recitation Alice", email: aliceEmail, password },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post("/api/auth/sign-in/email", {
          headers: { origin },
          data: { email: aliceEmail, password },
        })
      ).status(),
    ).toBe(200);
    const aliceId = sessionUserId(
      await (await page.request.get("/api/auth/get-session")).json(),
    );

    await page.goto("/bible/genesis/1");
    await page
      .getByRole("checkbox", { name: "Select Genesis 1:1 for memorisation" })
      .check();
    await page.getByRole("button", { name: "Add 1 Verse" }).click();
    await expect(page.getByRole("status")).toHaveText("1 verse added.");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/practice");
    await expect(
      page.getByRole("heading", { name: "Genesis 1:1" }),
    ).toBeVisible();
    await expect(
      page.getByText("In the beginning God created the heaven and the earth."),
    ).toBeHidden();
    await page.getByRole("button", { name: "Reveal verse" }).click();
    await expect(
      page.getByText("In the beginning God created the heaven and the earth."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Hide verse" }).click();

    const input = page.getByLabel("Type Genesis 1:1");
    await input.focus();
    await input.fill("wrong");
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue("wrong\n");
    await page.keyboard.press("Control+Enter");
    await expect(
      page.getByRole("heading", { name: "Keep practising" }),
    ).toBeVisible();
    await expect(page.getByText(/% accuracy/)).toBeVisible();

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(input).toBeFocused();
    await input.fill("In the beginning God created the heaven and the earth.");
    const submitted = page.waitForRequest(
      (request) =>
        request.url().endsWith("/api/recitation-attempts") &&
        request.method() === "POST",
    );
    await page.keyboard.press("Control+Enter");
    const payload = (await submitted).postDataJSON() as {
      itemId: string;
      operationId: string;
      text: string;
    };
    await expect(page.getByRole("heading", { name: "Passed" })).toBeVisible();
    await expect(page.getByText("100% accuracy")).toBeVisible();
    await expect(page.getByText("No word differences.")).toBeVisible();

    const replay = await page.request.post("/api/recitation-attempts", {
      headers: { origin },
      data: payload,
    });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).status).toBe("duplicate");

    const connection = await owner.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        "select set_config('mathaino.user_id', $1, true)",
        [aliceId],
      );
      const attempts = await connection.query<{ count: number }>(
        "select count(*)::int as count from practice_attempts where user_id = $1",
        [aliceId],
      );
      expect(attempts.rows).toEqual([{ count: 2 }]);
      await connection.query("ROLLBACK");
    } finally {
      connection.release();
    }

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await bob.request.post(`${origin}/api/auth/sign-up/email`, {
      headers: { origin },
      data: { name: "Recitation Bob", email: bobEmail, password },
    });
    await bob.request.post(`${origin}/api/auth/sign-in/email`, {
      headers: { origin },
      data: { email: bobEmail, password },
    });
    const denied = await bob.request.post(`${origin}/api/recitation-attempts`, {
      headers: { origin },
      data: {
        itemId: payload.itemId,
        operationId: randomUUID(),
        text: payload.text,
      },
    });
    expect(denied.status()).toBe(404);
  } finally {
    await bob.close();
    try {
      await authentication.query(
        "delete from users where email = any($1::text[])",
        [emails],
      );
    } finally {
      await authentication.end();
      await owner.end();
    }
  }
});
