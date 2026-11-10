import Link from "next/link";
import type {
  BibleBookView,
  BibleChapterSummary,
  BibleChapterView,
  BibleReference,
} from "../../application/bible-reader.ts";
import { VerseSelector } from "./verse-selector.tsx";

interface ChapterReaderProps {
  books: BibleBookView[];
  chapters: BibleChapterSummary[];
  chapter: BibleChapterView;
}

export function ChapterReader({
  books,
  chapters,
  chapter,
}: ChapterReaderProps) {
  const bookNames = new Map(books.map((book) => [book.id, book.name]));
  return (
    <div className="reader-page">
      <a className="skip-link" href="#scripture">
        Skip to Scripture
      </a>
      <header className="reader-topbar">
        <Link className="reader-wordmark" href="/">
          Mathaino
        </Link>
        <nav aria-label="Primary">
          <Link aria-current="page" href="/bible">
            Bible
          </Link>
          <Link href="/practice">Practice</Link>
          <Link href="/login">Sign In</Link>
        </nav>
      </header>
      <div className="reader-layout">
        <aside className="book-rail">
          <div className="book-rail-heading">
            <p>King James Version</p>
            <span>{books.length} books</span>
          </div>
          <BookNavigation books={books} currentBookId={chapter.book.id} />
        </aside>
        <main id="scripture" className="reader-main">
          <details className="mobile-book-picker">
            <summary>
              <span>Choose a Book</span>
              <strong>{chapter.book.name}</strong>
            </summary>
            <BookNavigation books={books} currentBookId={chapter.book.id} />
          </details>
          <article aria-labelledby="chapter-heading">
            <header className="chapter-heading">
              <div>
                <p>King James Version</p>
                <h1 id="chapter-heading">
                  {chapter.book.name} <span>{chapter.chapterId}</span>
                </h1>
              </div>
              <details className="chapter-picker">
                <summary>Chapter {chapter.chapterId}</summary>
                <nav aria-label={`${chapter.book.name} chapters`}>
                  {chapters.map(({ id }) => (
                    <Link
                      key={id}
                      href={`/bible/${chapter.book.id}/${id}`}
                      aria-current={
                        id === chapter.chapterId ? "page" : undefined
                      }
                    >
                      {id}
                    </Link>
                  ))}
                </nav>
              </details>
            </header>
            <ChapterNavigation
              previous={chapter.previous}
              next={chapter.next}
              bookNames={bookNames}
            />
            <VerseSelector
              bookId={chapter.book.id}
              bookName={chapter.book.name}
              chapterId={chapter.chapterId}
              verses={chapter.verses}
            />
            <ChapterNavigation
              previous={chapter.previous}
              next={chapter.next}
              bookNames={bookNames}
              bottom
            />
          </article>
        </main>
      </div>
    </div>
  );
}

function BookNavigation({
  books,
  currentBookId,
}: {
  books: BibleBookView[];
  currentBookId: string;
}) {
  return (
    <nav aria-label="Books" className="book-navigation">
      {books.map((book, index) => (
        <Link
          key={book.id}
          href={`/bible/${book.id}/${book.firstChapterId}`}
          aria-current={book.id === currentBookId ? "page" : undefined}
        >
          <span>{index + 1}</span>
          {book.name}
        </Link>
      ))}
    </nav>
  );
}

function ChapterNavigation({
  previous,
  next,
  bookNames,
  bottom = false,
}: {
  previous: BibleReference | null;
  next: BibleReference | null;
  bookNames: ReadonlyMap<string, string>;
  bottom?: boolean;
}) {
  const link = (reference: BibleReference, direction: "Previous" | "Next") => (
    <Link href={`/bible/${reference.bookId}/${reference.chapterId}`}>
      <span>{direction}</span>
      <strong>
        {bookNames.get(reference.bookId)} {reference.chapterId}
      </strong>
    </Link>
  );
  return (
    <nav
      aria-label={bottom ? "Next or previous chapter" : "Chapter navigation"}
      className={`chapter-navigation${bottom ? " chapter-navigation-bottom" : ""}`}
    >
      <div>{previous ? link(previous, "Previous") : null}</div>
      <div>{next ? link(next, "Next") : null}</div>
    </nav>
  );
}
