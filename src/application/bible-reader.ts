export interface BibleReference {
  bookId: string;
  chapterId: string;
}

export interface BibleVerseReference extends BibleReference {
  verseNumber: string;
}

export interface BibleBookView {
  id: string;
  name: string;
  firstChapterId: string;
}

export interface BibleChapterSummary {
  id: string;
}

export interface BibleVerseView {
  id: string;
  number: string;
  text: string;
}

export interface BibleChapterView {
  book: { id: string; name: string };
  chapterId: string;
  verses: BibleVerseView[];
  previous: BibleReference | null;
  next: BibleReference | null;
}

export interface BibleReader {
  listBooks(): Promise<BibleBookView[]>;
  listChapters(bookId: string): Promise<BibleChapterSummary[] | null>;
  getChapter(reference: BibleReference): Promise<BibleChapterView | null>;
}
