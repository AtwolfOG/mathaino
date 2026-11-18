import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getServices } from "@/composition/services";
import { SignOutButton } from "@/ui/authentication/sign-out-button";
import { TodayPractice } from "@/ui/learning/today-practice";
import { readLocalWhisperEnvironment } from "@/infrastructure/config/local-whisper-environment";
import { PracticeStreakStatus } from "@/ui/learning/practice-streak-status";

export const dynamic = "force-dynamic";
export default async function PracticePage() {
  const services = await getServices();
  const requestHeaders = await headers();
  const session = await services.auth.getSession(new Headers(requestHeaders));
  if (!session) redirect("/login");
  const authentication = {
    getUserId: async () => session.user.id,
  };
  const [queue, streak] = await Promise.all([
    services.learningQueue.read(authentication),
    services.practiceProgress.read(authentication),
  ]);
  return (
    <main className="today-shell">
      <header className="today-header">
        <Link className="auth-wordmark" href="/">
          Mathaino
        </Link>
        <nav aria-label="Account navigation">
          <Link href="/bible">Bible</Link>
          <Link href="/learning">Library</Link>
          <Link href="/progress">Progress</Link>
          <Link href="/settings">Settings</Link>
          <SignOutButton />
        </nav>
      </header>
      <div className="today-title">
        <h1>Today</h1>
        <p>Your learning verses and reviews due now.</p>
      </div>
      <PracticeStreakStatus {...streak} />
      <TodayPractice
        initialQueue={queue}
        localWhisperEnabled={readLocalWhisperEnvironment(process.env).enabled}
      />
    </main>
  );
}
