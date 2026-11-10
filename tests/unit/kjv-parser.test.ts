import { expect, test } from "vitest";
import { parseKjvSnapshot } from "@/infrastructure/bible/kjv-parser";
import { protestantKjv } from "@/infrastructure/bible/kjv-profile";
import {
  chapterPath,
  firstVerse,
  fixtureFiles,
  fixtureProfile,
  secondPath,
  secondVerse,
  snapshot,
  versePath,
} from "../helpers/kjv-fixture";

const parse = (files = fixtureFiles(), allowIdenticalDuplicates = false) =>
  parseKjvSnapshot(snapshot(files), {
    profile: fixtureProfile,
    allowIdenticalDuplicates,
  });

test("the canonical profile independently declares 66 books and 1189 chapters in Bible order", () => {
  expect(protestantKjv.books).toHaveLength(66);
  expect(
    protestantKjv.books.reduce((sum, book) => sum + book.chapters, 0),
  ).toBe(1189);
  expect(protestantKjv.books[0]?.id).toBe("genesis");
  expect(protestantKjv.books[39]?.id).toBe("matthew");
  expect(protestantKjv.books[65]?.id).toBe("revelation");
});

test("the observed chapter and individual verse layouts produce exact validated values", () => {
  const result = parse();
  expect(result.report.errors).toEqual([]);
  expect(result.data?.books).toEqual([
    { translationId: "en-kjv", id: "genesis", name: "Genesis", sortOrder: 1 },
  ]);
  expect(result.data?.chapters).toEqual([
    { translationId: "en-kjv", bookId: "genesis", id: "1", sortOrder: 1 },
  ]);
  expect(result.data?.verses.map((verse) => verse.text)).toEqual([
    firstVerse.text,
    secondVerse.text,
  ]);
  expect(result.report.selected).toEqual({ books: 1, chapters: 1, verses: 2 });
});

test("paragraph markers and annotations are preserved byte-for-byte as text", () => {
  const files = fixtureFiles();
  const text =
    "¶ And God said, Let there be a firmament in the midst of the waters, and let it divide the waters from the waters.1.6 firmament: Heb. expansion";
  files.set(
    chapterPath,
    JSON.stringify({ data: [{ ...firstVerse, text }, secondVerse] }),
  );
  files.set(versePath, JSON.stringify({ verse: "1", text }));
  expect(parse(files).data?.verses[0]?.text).toBe(text);
});

test.each([chapterPath, versePath, "en-kjv.json"])(
  "malformed JSON is reported with its exact source path (%s)",
  (path) => {
    const files = fixtureFiles();
    files.set(path, "{ broken");
    const result = parse(files);
    expect(result.data).toBeNull();
    expect(result.report.errors).toContainEqual(
      expect.objectContaining({ code: "malformed_json", path }),
    );
  },
);

test.each([
  { ...firstVerse, chapter: 1 },
  { ...firstVerse, book: "Exodus" },
  { ...firstVerse, chapter: "2" },
  { ...firstVerse, verse: "0" },
  { ...firstVerse, verse: "01" },
  { ...firstVerse, text: "\0" },
])("invalid source values or references are rejected (%j)", (record) => {
  const files = fixtureFiles();
  files.set(chapterPath, JSON.stringify({ data: [record, secondVerse] }));
  const result = parse(files);
  expect(result.data).toBeNull();
  expect(result.report.errors.length).toBeGreaterThan(0);
});

test("identical duplicates fail by default, but the approved policy reports and verifies them", () => {
  const files = fixtureFiles();
  files.set(
    chapterPath,
    JSON.stringify({ data: [firstVerse, secondVerse, firstVerse] }),
  );
  expect(parse(files).report.errors).toContainEqual(
    expect.objectContaining({ code: "duplicate_rejected" }),
  );
  const result = parse(files, true);
  expect(result.report.errors).toEqual([]);
  expect(result.report.duplicates).toEqual([
    { path: chapterPath, verse: "1", extraOccurrences: 1 },
  ]);
  expect(result.data?.verses).toHaveLength(2);
});

test("conflicting duplicates always fail even when identical deduplication is enabled", () => {
  const files = fixtureFiles();
  files.set(
    chapterPath,
    JSON.stringify({
      data: [
        firstVerse,
        { ...firstVerse, text: "Conflicting fixture" },
        secondVerse,
      ],
    }),
  );
  expect(parse(files, true).report.errors).toContainEqual(
    expect.objectContaining({ code: "conflicting_duplicate" }),
  );
});

test("both representations must agree and individual verse identifiers must match filenames", () => {
  const files = fixtureFiles();
  files.set(versePath, JSON.stringify({ verse: "2", text: "Mismatch" }));
  expect(parse(files).report.errors).toContainEqual(
    expect.objectContaining({ code: "invalid_reference", path: versePath }),
  );
});

test("a missing individual verse file is detected against the chapter array", () => {
  const files = fixtureFiles();
  files.delete(secondPath);
  expect(parse(files).report.errors).toContainEqual(
    expect.objectContaining({ code: "missing_verse", path: secondPath }),
  );
});

test("a missing canonical chapter is reported even if it was the final chapter", () => {
  const result = parseKjvSnapshot(snapshot(), {
    profile: {
      books: [{ id: "genesis", name: "Genesis", chapters: 2 }],
      verses: 2,
    },
  });
  expect(result.report.errors).toContainEqual(
    expect.objectContaining({
      code: "missing_chapter",
      path: "books/genesis/chapters/2.json",
    }),
  );
});

test("leading/internal verse gaps and aggregate shortages prevent import", () => {
  const files = fixtureFiles();
  files.set(chapterPath, JSON.stringify({ data: [secondVerse] }));
  files.delete(versePath);
  const result = parse(files);
  expect(result.report.errors).toContainEqual(
    expect.objectContaining({ code: "missing_verse" }),
  );
  expect(result.report.errors).toContainEqual(
    expect.objectContaining({ code: "coverage_mismatch" }),
  );
});

test("source book order is independent of filesystem order", () => {
  const files = fixtureFiles();
  files.set(
    "books/exodus/chapters/1.json",
    JSON.stringify({
      data: [{ book: "Exodus", chapter: "1", verse: "1", text: "Fixture" }],
    }),
  );
  files.set(
    "books/exodus/chapters/1/verses/1.json",
    JSON.stringify({ verse: "1", text: "Fixture" }),
  );
  const result = parseKjvSnapshot(snapshot(new Map([...files].reverse())), {
    profile: {
      books: [
        { id: "genesis", name: "Genesis", chapters: 1 },
        { id: "exodus", name: "Exodus", chapters: 1 },
      ],
      verses: 3,
    },
  });
  expect(result.data?.books.map((book) => book.id)).toEqual([
    "genesis",
    "exodus",
  ]);
});

test("Greek Esther partial numbering is not mistaken for missing canonical chapters", () => {
  const files = fixtureFiles();
  const path = "books/esther(greek)/chapters/10.json";
  files.set(
    path,
    JSON.stringify({
      data: [
        {
          book: "Esther (Greek)",
          chapter: "10",
          verse: "4",
          text: "Then Mardocheus said, God hath done these things.",
        },
      ],
    }),
  );
  files.set(
    "books/esther(greek)/chapters/10/verses/4.json",
    JSON.stringify({
      verse: "4",
      text: "Then Mardocheus said, God hath done these things.",
    }),
  );
  const result = parse(files);
  expect(result.report.errors).toEqual([]);
  expect(result.report.excludedBooks).toEqual([
    { id: "esther(greek)", chapters: 1, verses: 1 },
  ]);
});

test("an internal verse gap is detected even when both representations omit the same reference", () => {
  const files = fixtureFiles();
  files.set(
    chapterPath,
    JSON.stringify({ data: [firstVerse, { ...secondVerse, verse: "3" }] }),
  );
  files.delete(secondPath);
  files.set(
    "books/genesis/chapters/1/verses/3.json",
    JSON.stringify({ verse: "3", text: secondVerse.text }),
  );
  expect(parse(files).report.errors).toContainEqual(
    expect.objectContaining({ code: "missing_verse" }),
  );
});

test("aggregate coverage detects a trailing verse removed from both representations", () => {
  const files = fixtureFiles();
  files.set(chapterPath, JSON.stringify({ data: [firstVerse] }));
  files.delete(secondPath);
  expect(parse(files).report.errors).toContainEqual(
    expect.objectContaining({ code: "coverage_mismatch" }),
  );
});

test("individual text mismatches and orphan verse files are fatal", () => {
  const files = fixtureFiles();
  files.set(
    versePath,
    JSON.stringify({ verse: "1", text: "Mismatched fixture" }),
  );
  expect(parse(files).report.errors).toContainEqual(
    expect.objectContaining({ code: "text_mismatch", path: versePath }),
  );
  files.set(
    "books/genesis/chapters/1/verses/3.json",
    JSON.stringify({ verse: "3", text: "Orphan fixture" }),
  );
  expect(parse(files).report.errors).toContainEqual(
    expect.objectContaining({
      code: "invalid_reference",
      path: "books/genesis/chapters/1/verses/3.json",
    }),
  );
});

test("canonical books and chapter documents cannot disappear behind remaining verse directories", () => {
  const files = fixtureFiles();
  files.delete(chapterPath);
  expect(parse(files).report.errors).toContainEqual(
    expect.objectContaining({ code: "missing_chapter" }),
  );
  const result = parseKjvSnapshot(snapshot(), {
    profile: {
      books: [
        ...fixtureProfile.books,
        { id: "exodus", name: "Exodus", chapters: 1 },
      ],
      verses: 2,
    },
  });
  expect(result.report.errors).toContainEqual(
    expect.objectContaining({ code: "missing_book", path: "books/exodus" }),
  );
});

test.each([
  { verses: [] },
  { data: [] },
  { data: [{ verse: "1", text: "Missing fields" }] },
])("unobserved chapter shapes are rejected (%j)", (value) => {
  const files = fixtureFiles();
  files.set(chapterPath, JSON.stringify(value));
  expect(parse(files).report.errors).toContainEqual(
    expect.objectContaining({ code: "invalid_shape", path: chapterPath }),
  );
});

test("unsupported translation metadata and aliased filenames are rejected", () => {
  const files = fixtureFiles();
  files.set("en-kjv.json", JSON.stringify({ id: "other" }));
  files.set(
    "books/genesis/chapters/01.json",
    JSON.stringify({ data: [firstVerse] }),
  );
  const result = parse(files);
  expect(result.report.errors).toContainEqual(
    expect.objectContaining({ code: "invalid_metadata" }),
  );
  expect(result.report.errors).toContainEqual(
    expect.objectContaining({
      code: "invalid_reference",
      path: "books/genesis/chapters/01.json",
    }),
  );
});
