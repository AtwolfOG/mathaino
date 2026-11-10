import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-shell">
      <p className="home-kicker">Read. Keep. Recall.</p>
      <h1>Mathaino</h1>
      <p className="home-introduction">
        Read the King James Bible and keep the verses you want to know by heart.
      </p>
      <nav aria-label="Start reading">
        <Link className="home-primary" href="/bible">
          Browse the Bible
        </Link>
        <Link href="/practice">Open Your Practice</Link>
      </nav>
      <nav aria-label="Account" className="home-account">
        <Link href="/login">Sign In</Link>
        <Link href="/register">Create an Account</Link>
      </nav>
    </main>
  );
}
