import { expect, test, vi } from "vitest";
import { runBibleImport } from "@/application/bible-import";
import { parseKjvSnapshot } from "@/infrastructure/bible/kjv-parser";
import { parseImportOptions } from "@/infrastructure/bible/import-options";
import { fixtureProfile, snapshot } from "../helpers/kjv-fixture";

const source = {
  read: async () => parseKjvSnapshot(snapshot(), { profile: fixtureProfile }),
};
const summary = {
  inserted: { books: 1, chapters: 1, verses: 2 },
  orderValuesFilled: 0,
  verified: { books: 1, chapters: 1, verses: 2 },
};

test("a validated source reaches the persistence boundary and produces a truthful summary", async () => {
  const write = vi.fn(async () => summary);
  expect(await runBibleImport(source, { write })).toMatchObject({
    status: "imported",
    write: summary,
    error: null,
  });
  expect(write).toHaveBeenCalledOnce();
});

test("source errors prevent all database work", async () => {
  const invalid = await source.read();
  invalid.data = null;
  invalid.report.errors.push({
    code: "missing_verse",
    path: "fixture",
    message: "Missing fixture",
  });
  const write = vi.fn(async () => summary);
  expect(
    (await runBibleImport({ read: async () => invalid }, { write })).status,
  ).toBe("validation_failed");
  expect(write).not.toHaveBeenCalled();
});

test("validation-only mode never requires a database", async () => {
  expect(await runBibleImport(source)).toMatchObject({
    status: "validated",
    write: null,
  });
});

test("failed persistence is reported as failure rather than success", async () => {
  const result = await runBibleImport(source, {
    write: async () => {
      throw new Error("Fixture conflict");
    },
  });
  expect(result).toMatchObject({
    status: "import_failed",
    write: null,
    error: "Fixture conflict",
  });
});

test("duplicate acceptance and validation-only operation require explicit recognized flags", () => {
  expect(
    parseImportOptions(["--validate-only", "--allow-identical-duplicates"]),
  ).toEqual({ validateOnly: true, allowIdenticalDuplicates: true });
  expect(() => parseImportOptions(["--ignore-errors"])).toThrow(
    "Unknown import option",
  );
  expect(parseImportOptions([])).toEqual({
    validateOnly: false,
    allowIdenticalDuplicates: false,
  });
});
