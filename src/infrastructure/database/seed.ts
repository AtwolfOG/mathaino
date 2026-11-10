import "server-only";
import { and, eq } from "drizzle-orm";
import type { TransactionHost } from "./client.ts";
import { bibleBooks, bibleChapters, bibleVerses } from "./schema.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, fields: readonly string[]) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    !fields.every((field) => Object.hasOwn(value, field))
  ) {
    throw new Error("Invalid reference seed data.");
  }
  return value;
}

function string(value: unknown) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.includes("\0")
  ) {
    throw new Error("Invalid reference seed data.");
  }
  return value;
}

function parseSeed(data: unknown) {
  const root = record(data, ["books", "verses"]);
  if (!Array.isArray(root.books) || !Array.isArray(root.verses)) {
    throw new Error("Invalid reference seed data.");
  }
  const books = root.books.map((value: unknown) => {
    const item = record(value, ["translationId", "id", "name"]);
    return {
      translationId: string(item.translationId),
      id: string(item.id),
      name: string(item.name),
    };
  });
  const verses = root.verses.map((value: unknown) => {
    const item = record(value, [
      "translationId",
      "bookId",
      "chapter",
      "verse",
      "text",
    ]);
    return {
      translationId: string(item.translationId),
      bookId: string(item.bookId),
      chapter: string(item.chapter),
      verse: string(item.verse),
      text: string(item.text),
    };
  });
  return { books, verses };
}

export async function seedReferenceData(
  database: TransactionHost,
  data: unknown,
): Promise<{
  booksInserted: number;
  versesInserted: number;
}> {
  // This explicit internal payload is not a parser for any Bible JSON layout.
  const { books, verses } = parseSeed(data);
  return database.transaction(async (transaction) => {
    let booksInserted = 0;
    let versesInserted = 0;
    for (const book of books) {
      const inserted = await transaction
        .insert(bibleBooks)
        .values(book)
        .onConflictDoNothing({
          target: [bibleBooks.translationId, bibleBooks.id],
        })
        .returning({ id: bibleBooks.id });
      booksInserted += inserted.length;
      const [stored] = await transaction
        .select({ name: bibleBooks.name })
        .from(bibleBooks)
        .where(
          and(
            eq(bibleBooks.translationId, book.translationId),
            eq(bibleBooks.id, book.id),
          ),
        );
      if (!stored || stored.name !== book.name)
        throw new Error("Conflicting existing book.");
    }
    for (const verse of verses) {
      await transaction
        .insert(bibleChapters)
        .values({
          translationId: verse.translationId,
          bookId: verse.bookId,
          id: verse.chapter,
        })
        .onConflictDoNothing({
          target: [
            bibleChapters.translationId,
            bibleChapters.bookId,
            bibleChapters.id,
          ],
        });
      const inserted = await transaction
        .insert(bibleVerses)
        .values(verse)
        .onConflictDoNothing({
          target: [
            bibleVerses.translationId,
            bibleVerses.bookId,
            bibleVerses.chapter,
            bibleVerses.verse,
          ],
        })
        .returning({ id: bibleVerses.id });
      versesInserted += inserted.length;
      const [stored] = await transaction
        .select({ text: bibleVerses.text })
        .from(bibleVerses)
        .where(
          and(
            eq(bibleVerses.translationId, verse.translationId),
            eq(bibleVerses.bookId, verse.bookId),
            eq(bibleVerses.chapter, verse.chapter),
            eq(bibleVerses.verse, verse.verse),
          ),
        );
      if (!stored || stored.text !== verse.text)
        throw new Error("Conflicting existing verse.");
    }
    return { booksInserted, versesInserted };
  });
}
