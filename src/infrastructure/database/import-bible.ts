import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { BibleWriteSummary } from "../../application/bible-import.ts";
import type { BibleImportDataset } from "../../domain/bible.ts";
import type { TransactionHost } from "./client.ts";
import { bibleBooks, bibleChapters, bibleVerses } from "./schema.ts";

export async function writeBibleImport(
  database: TransactionHost,
  data: BibleImportDataset,
): Promise<BibleWriteSummary> {
  if (
    [...data.books, ...data.chapters, ...data.verses].some(
      (row) => row.translationId !== data.translationId,
    )
  ) {
    throw new Error("Mixed translation identifiers in import dataset.");
  }
  return database.transaction(async (transaction) => {
    const inserted = { books: 0, chapters: 0, verses: 0 };
    let orderValuesFilled = 0;
    for (let i = 0; i < data.books.length; i += 1000) {
      inserted.books += (
        await transaction
          .insert(bibleBooks)
          .values(data.books.slice(i, i + 1000))
          .onConflictDoNothing({
            target: [bibleBooks.translationId, bibleBooks.id],
          })
          .returning({ id: bibleBooks.id })
      ).length;
    }
    for (let i = 0; i < data.chapters.length; i += 1000) {
      inserted.chapters += (
        await transaction
          .insert(bibleChapters)
          .values(data.chapters.slice(i, i + 1000))
          .onConflictDoNothing({
            target: [
              bibleChapters.translationId,
              bibleChapters.bookId,
              bibleChapters.id,
            ],
          })
          .returning({ id: bibleChapters.id })
      ).length;
    }
    for (let i = 0; i < data.verses.length; i += 1000) {
      inserted.verses += (
        await transaction
          .insert(bibleVerses)
          .values(data.verses.slice(i, i + 1000))
          .onConflictDoNothing({
            target: [
              bibleVerses.translationId,
              bibleVerses.bookId,
              bibleVerses.chapter,
              bibleVerses.verse,
            ],
          })
          .returning({ id: bibleVerses.id })
      ).length;
    }
    const books = await transaction
      .select()
      .from(bibleBooks)
      .where(eq(bibleBooks.translationId, data.translationId));
    const chapters = await transaction
      .select()
      .from(bibleChapters)
      .where(eq(bibleChapters.translationId, data.translationId));
    const verses = await transaction
      .select()
      .from(bibleVerses)
      .where(eq(bibleVerses.translationId, data.translationId));
    if (books.length !== data.books.length)
      throw new Error(
        "Stored book coverage differs from the validated source.",
      );
    if (chapters.length !== data.chapters.length)
      throw new Error(
        "Stored chapter coverage differs from the validated source.",
      );
    if (verses.length !== data.verses.length)
      throw new Error(
        "Stored verse coverage differs from the validated source.",
      );
    const bookMap = new Map(books.map((book) => [book.id, book]));
    for (const expected of data.books) {
      const existing = bookMap.get(expected.id);
      if (
        !existing ||
        existing.name !== expected.name ||
        (existing.sortOrder !== null &&
          existing.sortOrder !== expected.sortOrder)
      )
        throw new Error(`Existing book differs: ${expected.id}.`);
      if (existing.sortOrder === null) {
        orderValuesFilled += (
          await transaction
            .update(bibleBooks)
            .set({ sortOrder: expected.sortOrder })
            .where(
              and(
                eq(bibleBooks.translationId, data.translationId),
                eq(bibleBooks.id, expected.id),
                isNull(bibleBooks.sortOrder),
              ),
            )
            .returning({ id: bibleBooks.id })
        ).length;
      }
    }
    const chapterMap = new Map(
      chapters.map((chapter) => [key(chapter.bookId, chapter.id), chapter]),
    );
    for (const expected of data.chapters) {
      const existing = chapterMap.get(key(expected.bookId, expected.id));
      if (
        !existing ||
        (existing.sortOrder !== null &&
          existing.sortOrder !== expected.sortOrder)
      )
        throw new Error(
          `Existing chapter differs: ${expected.bookId}/${expected.id}.`,
        );
      if (existing.sortOrder === null) {
        orderValuesFilled += (
          await transaction
            .update(bibleChapters)
            .set({ sortOrder: expected.sortOrder })
            .where(
              and(
                eq(bibleChapters.translationId, data.translationId),
                eq(bibleChapters.bookId, expected.bookId),
                eq(bibleChapters.id, expected.id),
                isNull(bibleChapters.sortOrder),
              ),
            )
            .returning({ id: bibleChapters.id })
        ).length;
      }
    }
    const verseMap = new Map(
      verses.map((verse) => [
        key(verse.bookId, verse.chapter, verse.verse),
        verse,
      ]),
    );
    for (const expected of data.verses) {
      const existing = verseMap.get(
        key(expected.bookId, expected.chapter, expected.verse),
      );
      if (!existing || existing.text !== expected.text)
        throw new Error(
          `Existing verse differs: ${expected.bookId}/${expected.chapter}/${expected.verse}.`,
        );
    }
    return {
      inserted,
      orderValuesFilled,
      verified: {
        books: books.length,
        chapters: chapters.length,
        verses: verses.length,
      },
    };
  });
}

function key(...values: string[]) {
  return JSON.stringify(values);
}
