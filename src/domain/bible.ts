export interface BibleImportBook {
  translationId: string;
  id: string;
  name: string;
  sortOrder: number;
}

export interface BibleImportChapter {
  translationId: string;
  bookId: string;
  id: string;
  sortOrder: number;
}

export interface BibleImportVerse {
  translationId: string;
  bookId: string;
  chapter: string;
  verse: string;
  text: string;
}

export interface BibleImportDataset {
  translationId: string;
  books: BibleImportBook[];
  chapters: BibleImportChapter[];
  verses: BibleImportVerse[];
}
