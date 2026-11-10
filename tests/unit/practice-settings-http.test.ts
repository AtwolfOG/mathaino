import { expect, test, vi } from "vitest";
import type { PracticeSettings } from "@/application/practice-settings";
import { handlePracticeSettingsRequest } from "@/ui/http/practice-settings";

const userId = "00000000-0000-4000-8000-000000000001";
const authentication = (id: string | null) => ({ getUserId: async () => id });
const view = { masteryThreshold: 3, timeZone: "Etc/UTC" };
const settings = (
  overrides: Partial<PracticeSettings> = {},
): PracticeSettings => ({
  read: async () => view,
  update: async (_authentication, value) => value,
  ...overrides,
});

test("reads and updates authenticated practice settings", async () => {
  const context = authentication(userId);
  const read = await handlePracticeSettingsRequest(
    new Request("https://mathaino.test/api/practice-settings"),
    settings(),
    context,
  );
  expect(read.status).toBe(200);
  await expect(read.json()).resolves.toEqual(view);

  const update = vi.fn<PracticeSettings["update"]>().mockResolvedValue({
    masteryThreshold: 5,
    timeZone: "Europe/London",
  });
  const response = await handlePracticeSettingsRequest(
    new Request("https://mathaino.test/api/practice-settings", {
      method: "PATCH",
      headers: {
        origin: "https://mathaino.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ masteryThreshold: 5, timeZone: "Europe/London" }),
    }),
    settings({ update }),
    context,
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    masteryThreshold: 5,
    timeZone: "Europe/London",
  });
  expect(update).toHaveBeenCalledWith(context, {
    masteryThreshold: 5,
    timeZone: "Europe/London",
  });
});

test("rejects anonymous, malformed and cross-origin settings", async () => {
  expect(
    (
      await handlePracticeSettingsRequest(
        new Request("https://mathaino.test/api/practice-settings"),
        settings(),
        authentication(null),
      )
    ).status,
  ).toBe(401);
  for (const [body, origin] of [
    [{ masteryThreshold: 0, timeZone: "Etc/UTC" }, "https://mathaino.test"],
    [{ masteryThreshold: 3, timeZone: "Not/AZone" }, "https://mathaino.test"],
    [
      { masteryThreshold: 3, timeZone: "Etc/UTC", ownerId: userId },
      "https://mathaino.test",
    ],
    [{ masteryThreshold: 3, timeZone: "Etc/UTC" }, "https://evil.test"],
  ] as const) {
    const response = await handlePracticeSettingsRequest(
      new Request("https://mathaino.test/api/practice-settings", {
        method: "PATCH",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      settings(),
      authentication(userId),
    );
    expect(response.status).toBe(origin.includes("evil") ? 403 : 400);
  }
});
