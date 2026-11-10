import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { runBibleImport } from "../src/application/bible-import.ts";
import { readKjvDirectory } from "../src/infrastructure/bible/kjv-directory.ts";
import { parseKjvSnapshot } from "../src/infrastructure/bible/kjv-parser.ts";
import { parseImportOptions } from "../src/infrastructure/bible/import-options.ts";
import { createDatabase } from "../src/infrastructure/database/client.ts";
import { writeBibleImport } from "../src/infrastructure/database/import-bible.ts";
import { validateDatabaseUrl } from "../src/infrastructure/config/environment.ts";

async function main() {
  const options = parseImportOptions(process.argv.slice(2));
  const root = fileURLToPath(new URL("../", import.meta.url));
  nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== "production");
  let connection: ReturnType<typeof createDatabase> | undefined;
  try {
    const source = {
      read: async () =>
        parseKjvSnapshot(
          await readKjvDirectory(join(root, "bible/kjv")),
          options,
        ),
    };
    const outcome = await runBibleImport(
      source,
      options.validateOnly
        ? undefined
        : {
            write: async (data) => {
              connection = createDatabase(
                validateDatabaseUrl(process.env.DATABASE_URL),
              );
              return writeBibleImport(connection.db, data);
            },
          },
    );
    // Reports have a fixed, non-source destination and are never overwritten.
    const reportDirectory = join(root, "reports");
    try {
      const info = await lstat(reportDirectory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Report destination must be a real project directory.");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        await mkdir(reportDirectory);
      else throw error;
    }
    if (
      (await realpath(reportDirectory)) !==
      join(await realpath(root), "reports")
    )
      throw new Error("Unsafe report destination.");
    const reportFile = join(
      reportDirectory,
      `kjv-import-${Date.now()}-${randomUUID()}.json`,
    );
    await writeFile(
      reportFile,
      JSON.stringify(
        {
          ...outcome,
          sourceDirectory: "bible/kjv",
          selection: "protestant-66",
          duplicatePolicy: options.allowIdenticalDuplicates
            ? "verified-identical"
            : "reject",
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log(
      JSON.stringify(
        {
          status: outcome.status,
          source: outcome.source.source,
          expected: outcome.source.expected,
          selected: outcome.source.selected,
          excludedBooks: outcome.source.excludedBooks,
          duplicateOccurrences: outcome.source.duplicates.reduce(
            (sum, duplicate) => sum + duplicate.extraOccurrences,
            0,
          ),
          errors: outcome.source.errors.length,
          warnings: outcome.source.warnings,
          write: outcome.write,
          error: outcome.error,
          reportFile,
        },
        null,
        2,
      ),
    );
    if (
      outcome.status === "validation_failed" ||
      outcome.status === "import_failed"
    )
      process.exitCode = 1;
  } finally {
    await connection?.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Unexpected KJV import failure.",
  );
  process.exitCode = 1;
});
