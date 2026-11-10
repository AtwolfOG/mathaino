import { redirect } from "next/navigation";
import { getBibleServices } from "@/composition/bible-services";

export const dynamic = "force-dynamic";

export default async function BiblePage() {
  const books = await getBibleServices().bible.listBooks();
  const first = books[0];
  if (!first) throw new Error("The KJV catalogue is unavailable.");
  redirect(`/bible/${first.id}/${first.firstChapterId}`);
}
