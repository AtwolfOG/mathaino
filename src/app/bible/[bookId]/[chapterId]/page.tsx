import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBibleServices } from "@/composition/bible-services";
import { ChapterReader } from "@/ui/bible/chapter-reader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "KJV Bible | Mathaino" };

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ bookId: string; chapterId: string }>;
}) {
  const { bookId, chapterId } = await params;
  const bible = getBibleServices().bible;
  const [books, chapters, chapter] = await Promise.all([
    bible.listBooks(),
    bible.listChapters(bookId),
    bible.getChapter({ bookId, chapterId }),
  ]);
  if (!chapters || !chapter) notFound();
  return <ChapterReader books={books} chapters={chapters} chapter={chapter} />;
}
