import { expect, test } from "@playwright/test";

test("the production application presents its accessible foundation", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Mathaino");
  await expect(
    page.getByRole("main").getByRole("heading", { level: 1, name: "Mathaino" }),
  ).toBeVisible();
});

test("the deployed health endpoint reports uncached liveness", async ({
  request,
}) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
