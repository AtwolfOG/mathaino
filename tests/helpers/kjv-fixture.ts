import type { SourceSnapshot } from "@/infrastructure/bible/kjv-parser";
import type { KjvProfile } from "@/infrastructure/bible/kjv-profile";

// Representative records copied from the inspected source, never written there.
export const firstVerse = {
  book: "Genesis",
  chapter: "1",
  verse: "1",
  text: "In the beginning God created the heaven and the earth.",
};
export const secondVerse = {
  book: "Genesis",
  chapter: "1",
  verse: "2",
  text: "And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.",
};
export const fixtureProfile: KjvProfile = {
  books: [{ id: "genesis", name: "Genesis", chapters: 1 }],
  verses: 2,
};
export const chapterPath = "books/genesis/chapters/1.json";
export const versePath = "books/genesis/chapters/1/verses/1.json";
export const secondPath = "books/genesis/chapters/1/verses/2.json";

export function fixtureFiles() {
  return new Map<string, string>([
    [
      "en-kjv.json",
      JSON.stringify({
        id: "en-kjv",
        version:
          "King James Version [eng] without Strong's numbers, 1769 standardized text",
        description:
          "English: King James Version of the Holy Bible (Bible with Deuterocanon)",
        scope: "Bible with Deuterocanon",
        language: { name: "English", code: "eng", level: "Common" },
        country: {
          name: "United Kingdom of Great Britain and Northern Ireland",
          code: "GB",
        },
        numeralSystem: "Arabic",
        script: "Latin",
        archivist: "KMPJ",
        copyright: "PUBLIC DOMAIN",
        localVersionName: "King James Version of the Holy Bible",
        localVersionAbbreviation: "KJV",
      }),
    ],
    [chapterPath, JSON.stringify({ data: [firstVerse, secondVerse] })],
    [
      versePath,
      JSON.stringify({ verse: firstVerse.verse, text: firstVerse.text }),
    ],
    [
      secondPath,
      JSON.stringify({ verse: secondVerse.verse, text: secondVerse.text }),
    ],
  ]);
}

export function snapshot(files = fixtureFiles()): SourceSnapshot {
  const directories = new Set<string>();
  for (const path of files.keys()) {
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++)
      directories.add(segments.slice(0, i).join("/"));
  }
  return { files, directories: [...directories], readErrors: [] };
}
