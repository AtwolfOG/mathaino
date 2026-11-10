import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthenticationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <Link className="auth-wordmark" href="/">
        Mathaino
      </Link>
      {children}
    </main>
  );
}
