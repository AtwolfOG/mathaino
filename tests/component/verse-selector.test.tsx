import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { VerseSelector } from "@/ui/bible/verse-selector";

const verses = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    number: "1",
    text: "In the beginning God created the heaven and the earth.",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    number: "2",
    text: "And the earth was without form, and void.",
  },
];

afterEach(() => vi.unstubAllGlobals());

test("one or more verses can be selected with clear references", () => {
  render(
    <VerseSelector
      bookId="genesis"
      bookName="Genesis"
      chapterId="1"
      verses={verses}
    />,
  );

  const first = screen.getByRole("checkbox", {
    name: "Select Genesis 1:1 for memorisation",
  });
  const second = screen.getByRole("checkbox", {
    name: "Select Genesis 1:2 for memorisation",
  });
  expect(screen.getByRole("button", { name: "Select Verses" })).toBeDisabled();
  fireEvent.click(first);
  expect(screen.getByRole("button", { name: "Add 1 Verse" })).toBeEnabled();
  fireEvent.click(second);
  expect(screen.getByRole("button", { name: "Add 2 Verses" })).toBeEnabled();
});

test("a selection is cleared when navigation changes the chapter", () => {
  const { rerender } = render(
    <VerseSelector
      bookId="genesis"
      bookName="Genesis"
      chapterId="1"
      verses={verses}
    />,
  );
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);

  rerender(
    <VerseSelector
      bookId="genesis"
      bookName="Genesis"
      chapterId="2"
      verses={verses}
    />,
  );

  expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Select Verses" })).toBeDisabled();
});

test("a saved selection reports additions and duplicate prevention", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ added: 1, existing: 1, restored: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <VerseSelector
      bookId="genesis"
      bookName="Genesis"
      chapterId="1"
      verses={verses}
    />,
  );
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  fireEvent.click(screen.getAllByRole("checkbox")[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Add 2 Verses" }));

  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 verse added. 1 was already in your practice.",
    ),
  );
  expect(fetch).toHaveBeenCalledWith("/api/learning-items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      references: [
        { bookId: "genesis", chapterId: "1", verseNumber: "1" },
        { bookId: "genesis", chapterId: "1", verseNumber: "2" },
      ],
    }),
  });
});

test("re-adding an archived verse reports restored progress", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(Response.json({ added: 0, existing: 0, restored: 1 })),
  );
  render(
    <VerseSelector
      bookId="genesis"
      bookName="Genesis"
      chapterId="1"
      verses={verses}
    />,
  );
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Add 1 Verse" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 verse restored with its progress.",
    ),
  );
});

test("anonymous and failed saves provide an actionable status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  );
  render(
    <VerseSelector
      bookId="genesis"
      bookName="Genesis"
      chapterId="1"
      verses={verses}
    />,
  );
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Add 1 Verse" }));

  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sign in to save selected verses.",
    ),
  );
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/login",
  );
});
