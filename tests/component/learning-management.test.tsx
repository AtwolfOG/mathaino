import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { LearningItemView } from "@/application/learning-reader";
import { LearningLibrary } from "@/ui/learning/learning-library";
import { LearningSettings } from "@/ui/learning/learning-settings";
import { PracticeSettingsForm } from "@/ui/learning/practice-settings";

const item: LearningItemView = {
  id: "20000000-0000-4000-8000-000000000001",
  translationId: "en-kjv",
  bookId: "john",
  bookName: "John",
  chapter: "3",
  verse: "16",
  text: "For God so loved the world.",
  state: "learning",
  status: "learning",
  archived: false,
};

afterEach(() => vi.unstubAllGlobals());

test("the library labels state and allows a removal override", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ removed: "archive" }, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  render(
    <LearningLibrary initialItems={[item]} defaultRemovalPolicy="archive" />,
  );
  expect(screen.getByText("Learning")).toBeVisible();
  fireEvent.click(screen.getByText("Manage"));
  fireEvent.change(screen.getByLabelText("Removal choice for John 3:16"), {
    target: { value: "delete" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove John 3:16" }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(fetch).toHaveBeenCalledWith(`/api/learning-items/${item.id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ policy: "delete" }),
  });
});

test("archived library items can be restored", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ restored: true }, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  render(
    <LearningLibrary
      initialItems={[{ ...item, archived: true }]}
      defaultRemovalPolicy="archive"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Restore John 3:16" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("John 3:16 restored."),
  );
  expect(fetch).toHaveBeenCalledWith(`/api/learning-items/${item.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ archived: false }),
  });
});

test("settings persist the default removal policy", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({ removalPolicy: "delete" }, { status: 200 }),
    );
  vi.stubGlobal("fetch", fetch);
  render(<LearningSettings initialPolicy="archive" />);
  fireEvent.click(screen.getByLabelText("Delete progress"));
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Preference saved."),
  );
  expect(fetch).toHaveBeenCalledWith("/api/learning-preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ removalPolicy: "delete" }),
  });
});

test("settings persist mastery threshold and account timezone", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { masteryThreshold: 5, timeZone: "Europe/London" },
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <PracticeSettingsForm
      initialSettings={{ masteryThreshold: 3, timeZone: "Etc/UTC" }}
      timeZones={["Etc/UTC", "Europe/London"]}
    />,
  );
  fireEvent.change(screen.getByLabelText("Days to mastery"), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByLabelText("Practice timezone"), {
    target: { value: "Europe/London" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save practice settings" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Practice settings saved.",
    ),
  );
  expect(fetch).toHaveBeenCalledWith("/api/practice-settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ masteryThreshold: 5, timeZone: "Europe/London" }),
  });
});
