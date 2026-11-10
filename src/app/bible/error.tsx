"use client";

import Link from "next/link";

export default function BibleError({ reset }: { reset: () => void }) {
  return (
    <main className="reader-message">
      <Link className="reader-wordmark" href="/">
        Mathaino
      </Link>
      <h1>The Bible Reader Is Unavailable</h1>
      <p>The local KJV catalogue could not be loaded. Try the request again.</p>
      <button type="button" onClick={reset}>
        Try Again
      </button>
    </main>
  );
}
