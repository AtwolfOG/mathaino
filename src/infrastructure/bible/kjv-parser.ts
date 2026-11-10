import type {
  BibleSourceReport,
  BibleSourceResult,
  ImportIssue,
} from "../../application/bible-import.ts";
import type {
  BibleImportDataset,
  BibleImportVerse,
} from "../../domain/bible.ts";
import {
  protestantKjv,
  sourceBookNames,
  type KjvProfile,
} from "./kjv-profile.ts";

export interface SourceSnapshot {
  files: ReadonlyMap<string, string>;
  directories: readonly string[];
  readErrors: readonly ImportIssue[];
}
export interface KjvParseOptions {
  allowIdenticalDuplicates?: boolean;
  profile?: KjvProfile;
}

export function parseKjvSnapshot(
  snapshot: SourceSnapshot,
  options: KjvParseOptions = {},
): BibleSourceResult {
  const profile = options.profile ?? protestantKjv;
  const report: BibleSourceReport = {
    metadata: null,
    source: {
      books: 0,
      chapters: 0,
      verses: 0,
      chapterRecords: 0,
      verseFiles: 0,
      jsonFiles: 0,
    },
    expected: {
      books: profile.books.length,
      chapters: profile.books.reduce((sum, book) => sum + book.chapters, 0),
      verses: profile.verses,
    },
    selected: { books: 0, chapters: 0, verses: 0 },
    excludedBooks: [],
    duplicates: [],
    errors: [],
    warnings: [],
  };
  report.source.jsonFiles = snapshot.files.size;
  report.errors.push(...snapshot.readErrors);
  const error = (code: string, path: string, message: string) =>
    report.errors.push({ code, path, message });
  const decode = (path: string): unknown => {
    const content = snapshot.files.get(path);
    if (content === undefined) {
      error("missing_file", path, "Required source file is missing.");
      return null;
    }
    try {
      const value: unknown = JSON.parse(content);
      return value;
    } catch {
      error("malformed_json", path, "Source is not valid JSON.");
      return null;
    }
  };
  const metadata = decode("en-kjv.json");
  const metadataStrings = [
    "id",
    "version",
    "description",
    "scope",
    "numeralSystem",
    "script",
    "archivist",
    "copyright",
    "localVersionName",
    "localVersionAbbreviation",
  ];
  if (
    isRecord(metadata) &&
    metadata.id === "en-kjv" &&
    stringFields(metadata, metadataStrings) &&
    stringFields(metadata.language, ["name", "code", "level"]) &&
    stringFields(metadata.country, ["name", "code"])
  ) {
    report.metadata = metadata;
  } else
    error(
      "invalid_metadata",
      "en-kjv.json",
      "Metadata does not match the observed en-kjv structure.",
    );

  const sourceBooks = new Set<string>();
  const chapterFiles: { path: string; bookId: string; chapter: string }[] = [];
  const verseFiles: {
    path: string;
    bookId: string;
    chapter: string;
    verse: string;
  }[] = [];
  for (const directory of snapshot.directories) {
    const match = /^books\/([^/]+)$/.exec(directory);
    if (match?.[1]) sourceBooks.add(match[1]);
    if (
      directory !== "books" &&
      !/^books\/[^/]+(?:\/chapters(?:\/[^/]+(?:\/verses)?)?)?$/.test(directory)
    ) {
      error("unexpected_path", directory, "Unexpected source directory.");
    }
  }
  for (const path of [...snapshot.files.keys()].sort()) {
    if (path === "en-kjv.json") continue;
    const chapter = /^books\/([^/]+)\/chapters\/([^/]+)\.json$/.exec(path);
    const verse =
      /^books\/([^/]+)\/chapters\/([^/]+)\/verses\/([^/]+)\.json$/.exec(path);
    if (chapter?.[1] && chapter[2]) {
      sourceBooks.add(chapter[1]);
      if (!sourceBookNames.has(chapter[1]) || !identifier(chapter[2]))
        error(
          "invalid_reference",
          path,
          "Unknown book or invalid chapter identifier.",
        );
      else chapterFiles.push({ path, bookId: chapter[1], chapter: chapter[2] });
    } else if (verse?.[1] && verse[2] && verse[3]) {
      if (
        !sourceBookNames.has(verse[1]) ||
        !identifier(verse[2]) ||
        !identifier(verse[3])
      )
        error(
          "invalid_reference",
          path,
          "Unknown book or invalid verse identifier.",
        );
      else
        verseFiles.push({
          path,
          bookId: verse[1],
          chapter: verse[2],
          verse: verse[3],
        });
    } else
      error(
        "unexpected_path",
        path,
        "File does not match the observed source layout.",
      );
  }
  for (const bookId of sourceBooks) {
    if (!sourceBookNames.has(bookId))
      error(
        "invalid_reference",
        `books/${bookId}`,
        "Unknown source book identifier.",
      );
  }
  const selectedIds = new Set(profile.books.map((book) => book.id));
  const chapters = new Map<
    string,
    {
      path: string;
      bookId: string;
      id: string;
      verses: Map<string, BibleImportVerse>;
    }
  >();
  for (const file of chapterFiles) {
    const document = decode(file.path);
    if (
      !exact(document, ["data"]) ||
      !Array.isArray(document.data) ||
      document.data.length === 0
    ) {
      error(
        "invalid_shape",
        file.path,
        "Chapter must contain a nonempty data array.",
      );
      continue;
    }
    const verses = new Map<string, BibleImportVerse>();
    const duplicates = new Map<string, number>();
    const records: readonly unknown[] = document.data;
    for (const value of records) {
      report.source.chapterRecords++;
      if (
        !exact(value, ["book", "chapter", "verse", "text"]) ||
        !text(value.book) ||
        !text(value.chapter) ||
        !text(value.verse) ||
        !text(value.text)
      ) {
        error(
          "invalid_shape",
          file.path,
          "Chapter records require string book, chapter, verse and text fields.",
        );
        continue;
      }
      if (
        value.book !== sourceBookNames.get(file.bookId) ||
        value.chapter !== file.chapter ||
        !identifier(value.verse)
      ) {
        error(
          "invalid_reference",
          file.path,
          "Record reference does not match its source book/chapter.",
        );
        continue;
      }
      const previous = verses.get(value.verse);
      if (previous) {
        duplicates.set(value.verse, (duplicates.get(value.verse) ?? 0) + 1);
        if (previous.text !== value.text)
          error(
            "conflicting_duplicate",
            file.path,
            `Conflicting text for verse ${value.verse}.`,
          );
      } else
        verses.set(value.verse, {
          translationId: "en-kjv",
          bookId: file.bookId,
          chapter: file.chapter,
          verse: value.verse,
          text: value.text,
        });
    }
    for (const [verse, extraOccurrences] of duplicates)
      report.duplicates.push({ path: file.path, verse, extraOccurrences });
    const numbers = [...verses.keys()].map(Number).sort((a, b) => a - b);
    let previous = selectedIds.has(file.bookId) ? 0 : (numbers[0] ?? 1) - 1;
    for (const number of numbers) {
      if (number > previous + 1)
        error(
          "missing_verse",
          file.path,
          `Missing verse range ${previous + 1}-${number - 1}.`,
        );
      previous = number;
    }
    chapters.set(`${file.bookId}/${file.chapter}`, {
      path: file.path,
      bookId: file.bookId,
      id: file.chapter,
      verses,
    });
  }
  const present = new Set<string>();
  for (const file of verseFiles) {
    const document = decode(file.path);
    if (
      !exact(document, ["verse", "text"]) ||
      !text(document.verse) ||
      !text(document.text)
    ) {
      error(
        "invalid_shape",
        file.path,
        "Individual verse requires string verse and text fields.",
      );
      continue;
    }
    if (document.verse !== file.verse) {
      error(
        "invalid_reference",
        file.path,
        "Verse identifier differs from filename.",
      );
      continue;
    }
    const chapter = chapters.get(`${file.bookId}/${file.chapter}`);
    const expected = chapter?.verses.get(file.verse);
    if (!chapter)
      error(
        "missing_chapter",
        `books/${file.bookId}/chapters/${file.chapter}.json`,
        "Verse directory has no valid chapter document.",
      );
    else if (!expected)
      error(
        "invalid_reference",
        file.path,
        "Individual verse is absent from the chapter array.",
      );
    else if (expected.text !== document.text)
      error(
        "text_mismatch",
        file.path,
        "Individual verse and chapter text differ.",
      );
    present.add(`${file.bookId}/${file.chapter}/${file.verse}`);
  }
  for (const chapter of chapters.values()) {
    for (const verse of chapter.verses.values()) {
      if (!present.has(`${verse.bookId}/${verse.chapter}/${verse.verse}`))
        error(
          "missing_verse",
          `books/${verse.bookId}/chapters/${verse.chapter}/verses/${verse.verse}.json`,
          "Missing individual verse document.",
        );
    }
  }
  const data: BibleImportDataset = {
    translationId: "en-kjv",
    books: [],
    chapters: [],
    verses: [],
  };
  for (const [index, book] of profile.books.entries()) {
    if (sourceBooks.has(book.id))
      data.books.push({
        translationId: "en-kjv",
        id: book.id,
        name: book.name,
        sortOrder: index + 1,
      });
    else
      error("missing_book", `books/${book.id}`, "Canonical book is missing.");
    for (let number = 1; number <= book.chapters; number++) {
      const chapter = chapters.get(`${book.id}/${number}`);
      if (!chapter) {
        error(
          "missing_chapter",
          `books/${book.id}/chapters/${number}.json`,
          "Expected canonical chapter is missing.",
        );
        continue;
      }
      data.chapters.push({
        translationId: "en-kjv",
        bookId: book.id,
        id: String(number),
        sortOrder: number,
      });
      data.verses.push(
        ...[...chapter.verses.values()].sort(
          (a, b) => Number(a.verse) - Number(b.verse),
        ),
      );
    }
    for (const chapter of chapters.values()) {
      if (chapter.bookId === book.id && Number(chapter.id) > book.chapters)
        error(
          "invalid_reference",
          chapter.path,
          "Chapter exceeds canonical range.",
        );
    }
  }
  for (const bookId of [...sourceBooks].sort()) {
    const values = [...chapters.values()].filter(
      (chapter) => chapter.bookId === bookId,
    );
    if (values.length === 0)
      error(
        "missing_chapter",
        `books/${bookId}/chapters`,
        "Book has no valid chapters.",
      );
    if (!selectedIds.has(bookId))
      report.excludedBooks.push({
        id: bookId,
        chapters: values.length,
        verses: values.reduce((sum, chapter) => sum + chapter.verses.size, 0),
      });
  }
  report.source.books = sourceBooks.size;
  report.source.chapters = chapters.size;
  report.source.verses = [...chapters.values()].reduce(
    (sum, chapter) => sum + chapter.verses.size,
    0,
  );
  report.source.verseFiles = verseFiles.length;
  report.selected = {
    books: data.books.length,
    chapters: data.chapters.length,
    verses: data.verses.length,
  };
  if (
    report.selected.books !== report.expected.books ||
    report.selected.chapters !== report.expected.chapters ||
    report.selected.verses !== report.expected.verses
  ) {
    error(
      "coverage_mismatch",
      "books",
      `Expected ${JSON.stringify(report.expected)}; found ${JSON.stringify(report.selected)}.`,
    );
  }
  if (report.duplicates.length) {
    const count = report.duplicates.reduce(
      (sum, value) => sum + value.extraOccurrences,
      0,
    );
    if (!options.allowIdenticalDuplicates)
      error(
        "duplicate_rejected",
        "books",
        `${count} duplicate records require explicit identical-deduplication approval.`,
      );
    else
      report.warnings.push({
        code: "identical_duplicates",
        path: "books",
        message: `${count} duplicate occurrences checked against individual verse files; see duplicate locations.`,
      });
  }
  if (report.excludedBooks.length)
    report.warnings.push({
      code: "excluded_books",
      path: "books",
      message: `${report.excludedBooks.length} source books are outside the selected Protestant profile.`,
    });
  return { data: report.errors.length ? null : data, report };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.includes("\0") &&
    value.isWellFormed()
  );
}
function identifier(value: string) {
  return /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
}
function stringFields(value: unknown, keys: readonly string[]) {
  return isRecord(value) && keys.every((key) => text(value[key]));
}
