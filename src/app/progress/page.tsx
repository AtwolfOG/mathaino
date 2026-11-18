import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServices } from "@/composition/services";
import { SignOutButton } from "@/ui/authentication/sign-out-button";
import { PracticeStreakStatus } from "@/ui/learning/practice-streak-status";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const services = await getServices();
  const requestHeaders = await headers();
  const session = await services.auth.getSession(new Headers(requestHeaders));
  if (!session) redirect("/login");
  const streak = await services.practiceProgress.read({
    getUserId: async () => session.user.id,
  });

  return (
    <main className="progress-shell">
      <header className="today-header">
        <Link className="auth-wordmark" href="/">
          Mathaino
        </Link>
        <nav aria-label="Account navigation">
          <Link href="/practice">Today</Link>
          <Link href="/bible">Bible</Link>
          <Link href="/learning">Library</Link>
          <Link aria-current="page" href="/progress">
            Progress
          </Link>
          <Link href="/settings">Settings</Link>
          <SignOutButton />
        </nav>
      </header>
      <div className="management-title">
        <h1>Progress</h1>
        <p>Your consistency across learning and review practice.</p>
      </div>
      <PracticeStreakStatus {...streak} />
    </main>
  );
}
