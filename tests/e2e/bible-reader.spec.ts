import { expect, test } from "@playwright/test";

test("desktop readers can browse the canonical collection and navigate chapters", async ({
  page,
}) => {
  await page.goto("/bible/genesis/1");

  await expect(page).toHaveTitle("KJV Bible | Mathaino");
  await expect(
    page.getByRole("heading", { level: 1, name: "Genesis 1" }),
  ).toBeVisible();
  await expect(page.locator(".book-rail")).toBeVisible();
  await expect(page.locator(".mobile-book-picker")).toBeHidden();
  await expect(page.locator(".book-rail .book-navigation a")).toHaveCount(66);
  await expect(
    page.getByText("In the beginning God created the heaven and the earth."),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Chapter navigation" })
    .getByRole("link", { name: "Next Genesis 2" })
    .click();
  await expect(page).toHaveURL(/\/bible\/genesis\/2$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Genesis 2" }),
  ).toBeVisible();
});

test("the reader remains usable on mobile without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/bible/genesis/1");

  await expect(page.locator(".book-rail")).toBeHidden();
  await expect(page.locator(".mobile-book-picker")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.locator(".mobile-book-picker summary").click();
  await expect(
    page
      .locator(".mobile-book-picker")
      .getByRole("link", { name: /Revelation/ }),
  ).toBeVisible();
});

test("verse selection and save recovery work by keyboard", async ({ page }) => {
  await page.goto("/bible/genesis/1");
  const verse = page.getByRole("checkbox", {
    name: "Select Genesis 1:1 for memorisation",
  });

  await verse.focus();
  await page.keyboard.press("Space");
  await expect(verse).toBeChecked();
  const save = page.getByRole("button", { name: "Add 1 Verse" });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(
    "Sign in to save selected verses.",
  );
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("missing Bible references return a clear not-found page", async ({
  page,
}) => {
  const response = await page.goto("/bible/genesis/0");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Reference Not Found" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Browse the Bible" }),
  ).toBeVisible();
});
