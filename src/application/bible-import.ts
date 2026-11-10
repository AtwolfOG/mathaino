import type { BibleImportDataset } from "../domain/bible.ts";

export interface ImportIssue {
  code: string;
  path: string;
  message: string;
}
export interface CoverageCounts {
  books: number;
  chapters: number;
  verses: number;
}
export interface BibleSourceReport {
  metadata: Record<string, unknown> | null;
  source: CoverageCounts & {
    chapterRecords: number;
    verseFiles: number;
    jsonFiles: number;
  };
  expected: CoverageCounts;
  selected: CoverageCounts;
  excludedBooks: { id: string; chapters: number; verses: number }[];
  duplicates: { path: string; verse: string; extraOccurrences: number }[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
}
export interface BibleSourceResult {
  data: BibleImportDataset | null;
  report: BibleSourceReport;
}
export interface BibleImportSource {
  read(): Promise<BibleSourceResult>;
}
export interface BibleWriteSummary {
  inserted: CoverageCounts;
  orderValuesFilled: number;
  verified: CoverageCounts;
}
export interface BibleImportStore {
  write(data: BibleImportDataset): Promise<BibleWriteSummary>;
}

export interface BibleImportOutcome {
  status: "validated" | "imported" | "validation_failed" | "import_failed";
  source: BibleSourceReport;
  write: BibleWriteSummary | null;
  error: string | null;
}

export async function runBibleImport(
  source: BibleImportSource,
  store?: BibleImportStore,
): Promise<BibleImportOutcome> {
  const result = await source.read();
  if (!result.data || result.report.errors.length)
    return {
      status: "validation_failed",
      source: result.report,
      write: null,
      error: null,
    };
  if (!store)
    return {
      status: "validated",
      source: result.report,
      write: null,
      error: null,
    };
  try {
    return {
      status: "imported",
      source: result.report,
      write: await store.write(result.data),
      error: null,
    };
  } catch (error) {
    return {
      status: "import_failed",
      source: result.report,
      write: null,
      error:
        error instanceof Error
          ? error.message
          : "Unexpected database import failure.",
    };
  }
}
