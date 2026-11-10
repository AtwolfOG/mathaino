import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("the native validation command reports actual source discrepancies without a database", async () => {
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      fileURLToPath(new URL("../../scripts/import-kjv.mts", import.meta.url)),
      "--validate-only",
      "--allow-identical-duplicates",
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, DATABASE_URL: "", NODE_ENV: "test" },
      encoding: "utf8",
      timeout: 30000,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const summary: unknown = JSON.parse(result.stdout);
  expect(summary).toMatchObject({
    status: "validated",
    selected: { books: 66, chapters: 1189, verses: 31102 },
    source: { books: 80, chapters: 1362, verses: 36820 },
    duplicateOccurrences: 31102,
    excludedBooks: expect.any(Array),
    errors: 0,
  });
  if (
    typeof summary !== "object" ||
    summary === null ||
    !("reportFile" in summary) ||
    typeof summary.reportFile !== "string"
  )
    throw new Error("Missing report path");
  const report: unknown = JSON.parse(
    await readFile(summary.reportFile, "utf8"),
  );
  expect(report).toMatchObject({
    status: "validated",
    source: {
      expected: { books: 66, chapters: 1189, verses: 31102 },
      errors: [],
      metadata: { id: "en-kjv", scope: "Bible with Deuterocanon" },
    },
    write: null,
  });
}, 40000);
