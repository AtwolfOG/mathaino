import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getServices } from "@/composition/services";
import { SignOutButton } from "@/ui/authentication/sign-out-button";
import { LearningLibrary } from "@/ui/learning/learning-library";

export const dynamic = "force-dynamic";

export default async function LearningPage() {
  const services = await getServices();
  const requestHeaders = await headers();
  const session = await services.auth.getSession(new Headers(requestHeaders));
  if (!session) redirect("/login");
  const authentication = { getUserId: async () => session.user.id };
  const [items, removalPolicy] = await Promise.all([
    services.learning.list(authentication),
    services.learningWriter.getRemovalPolicy(authentication),
  ]);
  return (
    <main className="library-shell">
      <PageHeader current="Library" />
      <div className="management-title">
        <h1>Learning library</h1>
        <p>Manage active, mastered, due, and archived verses.</p>
      </div>
      <LearningLibrary
        initialItems={items}
        defaultRemovalPolicy={removalPolicy}
      />
    </main>
  );
}

function PageHeader({ current }: { current: string }) {
  return (
    <header className="today-header">
      <Link className="auth-wordmark" href="/">
        Mathaino
      </Link>
      <nav aria-label="Account navigation">
        <Link href="/practice">Today</Link>
        <Link href="/bible">Bible</Link>
        <Link aria-current="page" href="/learning">
          {current}
        </Link>
        <Link href="/progress">Progress</Link>
        <Link href="/settings">Settings</Link>
        <SignOutButton />
      </nav>
    </header>
  );
}
