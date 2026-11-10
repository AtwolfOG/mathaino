import { sql } from "drizzle-orm";
import { getTestDatabaseUrl } from "../tests/helpers/database-url.ts";
import { readAuthEnvironment } from "../src/infrastructure/config/auth-environment.ts";
import { createDatabase } from "../src/infrastructure/database/client.ts";
import { applyMigrations } from "../src/infrastructure/database/migrate.ts";
import { seedReferenceData } from "../src/infrastructure/database/seed.ts";
import { writeBibleImport } from "../src/infrastructure/database/import-bible.ts";
import { protestantKjv } from "../src/infrastructure/bible/kjv-profile.ts";

const databaseURL = getTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const authDatabaseURL = getTestDatabaseUrl(process.env.TEST_AUTH_DATABASE_URL);
const config = readAuthEnvironment({
  ...process.env,
  DATABASE_URL: databaseURL,
  AUTH_DATABASE_URL: authDatabaseURL,
});
if (new URL(databaseURL).pathname !== "/mathaino_auth_e2e_test")
  throw new Error(
    "E2E preparation requires the dedicated mathaino_auth_e2e_test store.",
  );
const owner = createDatabase(databaseURL);
const authentication = createDatabase(config.authDatabaseURL);
try {
  await applyMigrations(owner.db);
  // Only ephemeral abuse counters in this dedicated test fixture store are reset.
  await authentication.db.execute(sql`delete from auth_rate_limits`);
  const books = protestantKjv.books.map((book, index) => ({
    translationId: "en-kjv",
    id: book.id,
    name: book.name,
    sortOrder: index + 1,
  }));
  const chapters = protestantKjv.books.flatMap((book) =>
    Array.from({ length: book.chapters }, (_, index) => ({
      translationId: "en-kjv",
      bookId: book.id,
      id: String(index + 1),
      sortOrder: index + 1,
    })),
  );
  const verses = chapters.map((chapter) => ({
    translationId: "en-kjv",
    bookId: chapter.bookId,
    chapter: chapter.id,
    verse: "1",
    text:
      chapter.bookId === "genesis" && chapter.id === "1"
        ? "In the beginning God created the heaven and the earth."
        : `Browser fixture for ${chapter.bookId} ${chapter.id}:1.`,
  }));
  verses.push({
    translationId: "en-kjv",
    bookId: "genesis",
    chapter: "1",
    verse: "2",
    text: "And the earth was without form, and void; and darkness was upon the face of the deep.",
  });
  await writeBibleImport(owner.db, {
    translationId: "en-kjv",
    books,
    chapters,
    verses,
  });
  await seedReferenceData(owner.db, {
    books: [
      {
        translationId: "auth-e2e",
        id: "fixture",
        name: "Authentication fixture",
      },
    ],
    verses: [
      {
        translationId: "auth-e2e",
        bookId: "fixture",
        chapter: "1",
        verse: "1",
        text: "Authentication ownership fixture.",
      },
    ],
  });
} finally {
  await authentication.close();
  await owner.close();
}
