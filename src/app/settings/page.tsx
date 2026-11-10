import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getServices } from "@/composition/services";
import { SignOutButton } from "@/ui/authentication/sign-out-button";
import { LearningSettings } from "@/ui/learning/learning-settings";
import { PracticeSettingsForm } from "@/ui/learning/practice-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const services = await getServices();
  const requestHeaders = await headers();
  const session = await services.auth.getSession(new Headers(requestHeaders));
  if (!session) redirect("/login");
  const authentication = { getUserId: async () => session.user.id };
  const [removalPolicy, practiceSettings] = await Promise.all([
    services.learningWriter.getRemovalPolicy(authentication),
    services.practiceSettings.read(authentication),
  ]);
  const timeZones = [
    "Etc/UTC",
    ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "Etc/UTC"),
  ];
  return (
    <main className="settings-shell">
      <header className="today-header">
        <Link className="auth-wordmark" href="/">
          Mathaino
        </Link>
        <nav aria-label="Account navigation">
          <Link href="/practice">Today</Link>
          <Link href="/bible">Bible</Link>
          <Link href="/learning">Library</Link>
          <Link aria-current="page" href="/settings">
            Settings
          </Link>
          <SignOutButton />
        </nav>
      </header>
      <div className="management-title">
        <h1>Settings</h1>
        <p>Choose your learning rhythm and how removed verses are handled.</p>
      </div>
      <PracticeSettingsForm
        initialSettings={practiceSettings}
        timeZones={timeZones}
      />
      <LearningSettings initialPolicy={removalPolicy} />
    </main>
  );
}
