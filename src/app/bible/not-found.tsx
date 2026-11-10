import Link from "next/link";

export default function BibleNotFound() {
  return (
    <main className="reader-message">
      <Link className="reader-wordmark" href="/">
        Mathaino
      </Link>
      <h1>Reference Not Found</h1>
      <p>This book or chapter is not available in the KJV catalogue.</p>
      <Link className="reader-primary-link" href="/bible">
        Browse the Bible
      </Link>
    </main>
  );
}
