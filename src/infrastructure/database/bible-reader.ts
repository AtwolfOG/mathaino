import "server-only";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { BibleReader } from "../../application/bible-reader.ts";
import type { TransactionHost } from "./client.ts";
import { bibleBooks, bibleChapters, bibleVerses } from "./schema.ts";

const translationId = "en-kjv";
const bookIdentifier = /^[a-z0-9]+$/;
const numberIdentifier = /^[1-9][0-9]*$/;

export function createBibleReader(database: TransactionHost): BibleReader {
  return {
    listBooks: () =>
      database.transaction(async (transaction) => {
        const books = await transaction
          .select({ id: bibleBooks.id, name: bibleBooks.name })
          .from(bibleBooks)
          .where(
            and(
              eq(bibleBooks.translationId, translationId),
              isNotNull(bibleBooks.sortOrder),
            ),
          )
          .orderBy(asc(bibleBooks.sortOrder));
        const chapters = await transaction
          .select({ bookId: bibleChapters.bookId, id: bibleChapters.id })
          .from(bibleChapters)
          .where(
            and(
              eq(bibleChapters.translationId, translationId),
              isNotNull(bibleChapters.sortOrder),
            ),
          )
          .orderBy(asc(bibleChapters.sortOrder));
        const firstChapters = new Map<string, string>();
        for (const chapter of chapters)
          if (!firstChapters.has(chapter.bookId))
            firstChapters.set(chapter.bookId, chapter.id);
        return books.map((book) => {
          const firstChapterId = firstChapters.get(book.id);
          if (!firstChapterId)
            throw new Error("The KJV catalogue is incomplete.");
          return { ...book, firstChapterId };
        });
      }),
    listChapters: async (bookId) => {
      if (!bookIdentifier.test(bookId)) return null;
      return database.transaction(async (transaction) => {
        const chapters = await transaction
          .select({ id: bibleChapters.id })
          .from(bibleChapters)
          .where(
            and(
              eq(bibleChapters.translationId, translationId),
              eq(bibleChapters.bookId, bookId),
              isNotNull(bibleChapters.sortOrder),
            ),
          )
          .orderBy(asc(bibleChapters.sortOrder));
        return chapters.length ? chapters : null;
      });
    },
    getChapter: async ({ bookId, chapterId }) => {
      if (!bookIdentifier.test(bookId) || !numberIdentifier.test(chapterId))
        return null;
      return database.transaction(async (transaction) => {
        const catalogue = await transaction
          .select({
            bookId: bibleBooks.id,
            bookName: bibleBooks.name,
            chapterId: bibleChapters.id,
          })
          .from(bibleChapters)
          .innerJoin(
            bibleBooks,
            and(
              eq(bibleBooks.translationId, bibleChapters.translationId),
              eq(bibleBooks.id, bibleChapters.bookId),
            ),
          )
          .where(
            and(
              eq(bibleChapters.translationId, translationId),
              isNotNull(bibleBooks.sortOrder),
              isNotNull(bibleChapters.sortOrder),
            ),
          )
          .orderBy(asc(bibleBooks.sortOrder), asc(bibleChapters.sortOrder));
        const index = catalogue.findIndex(
          (chapter) =>
            chapter.bookId === bookId && chapter.chapterId === chapterId,
        );
        const current = catalogue[index];
        if (!current) return null;
        const verses = await transaction
          .select({
            id: bibleVerses.id,
            number: bibleVerses.verse,
            text: bibleVerses.text,
          })
          .from(bibleVerses)
          .where(
            and(
              eq(bibleVerses.translationId, translationId),
              eq(bibleVerses.bookId, bookId),
              eq(bibleVerses.chapter, chapterId),
            ),
          )
          .orderBy(sql`${bibleVerses.verse}::integer`);
        if (!verses.length) throw new Error("The KJV catalogue is incomplete.");
        const reference = (position: number) => {
          const chapter = catalogue[position];
          return chapter
            ? { bookId: chapter.bookId, chapterId: chapter.chapterId }
            : null;
        };
        return {
          book: { id: current.bookId, name: current.bookName },
          chapterId: current.chapterId,
          verses,
          previous: reference(index - 1),
          next: reference(index + 1),
        };
      });
    },
  };
}
