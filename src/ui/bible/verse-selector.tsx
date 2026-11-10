"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { BibleVerseView } from "../../application/bible-reader.ts";

interface VerseSelectorProps {
  bookId: string;
  bookName: string;
  chapterId: string;
  verses: BibleVerseView[];
}

export function VerseSelector({
  bookId,
  chapterId,
  ...props
}: VerseSelectorProps) {
  return (
    <VerseSelection
      key={`${bookId}/${chapterId}`}
      bookId={bookId}
      chapterId={chapterId}
      {...props}
    />
  );
}

function VerseSelection({
  bookId,
  bookName,
  chapterId,
  verses,
}: VerseSelectorProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const selectedCount = selected.size;

  function select(verseNumber: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(verseNumber);
      else next.delete(verseNumber);
      return next;
    });
    setMessage("");
    setAuthenticationRequired(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCount || pending) return;
    setPending(true);
    setMessage("");
    setAuthenticationRequired(false);
    try {
      const response = await fetch("/api/learning-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          references: [...selected].map((verseNumber) => ({
            bookId,
            chapterId,
            verseNumber,
          })),
        }),
      });
      if (response.status === 401) {
        setAuthenticationRequired(true);
        setMessage("Sign in to save selected verses.");
        return;
      }
      if (!response.ok) {
        setMessage("Selected verses could not be saved. Try again.");
        return;
      }
      const result: unknown = await response.json();
      if (!isSaveResult(result)) {
        setMessage("Selected verses could not be saved. Try again.");
        return;
      }
      setMessage(savedMessage(result.added, result.existing, result.restored));
      setSelected(new Set());
    } catch {
      setMessage("Selected verses could not be saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="verse-selection-form">
      <ol className="reader-verses">
        {verses.map((verse) => (
          <li
            key={verse.id}
            className={
              selected.has(verse.number) ? "verse-selected" : undefined
            }
          >
            <label className="verse-label">
              <input
                type="checkbox"
                checked={selected.has(verse.number)}
                onChange={(event) => select(verse.number, event.target.checked)}
                aria-label={`Select ${bookName} ${chapterId}:${verse.number} for memorisation`}
              />
              <span className="verse-number">{verse.number}</span>
              <span className="verse-text">{verse.text}</span>
            </label>
          </li>
        ))}
      </ol>
      <div className="selection-bar">
        <p role="status" aria-live="polite">
          {message}
          {authenticationRequired ? (
            <>
              {" "}
              <Link href="/login">Sign in</Link>
            </>
          ) : null}
        </p>
        <button type="submit" disabled={!selectedCount || pending}>
          {pending
            ? "Adding…"
            : selectedCount
              ? `Add ${selectedCount} ${selectedCount === 1 ? "Verse" : "Verses"}`
              : "Select Verses"}
        </button>
      </div>
    </form>
  );
}

function isSaveResult(
  value: unknown,
): value is { added: number; existing: number; restored: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "added" in value &&
    "existing" in value &&
    "restored" in value &&
    typeof value.added === "number" &&
    typeof value.existing === "number" &&
    typeof value.restored === "number"
  );
}

function savedMessage(added: number, existing: number, restored: number) {
  const messages = [];
  if (added || !restored)
    messages.push(`${added} ${added === 1 ? "verse" : "verses"} added.`);
  const restoredText = restored
    ? `${restored} ${restored === 1 ? "verse" : "verses"} restored with ${restored === 1 ? "its" : "their"} progress.`
    : "";
  const existingText = existing
    ? `${existing} ${existing === 1 ? "was" : "were"} already in your practice.`
    : "";
  if (restoredText) messages.push(restoredText);
  if (existingText) messages.push(existingText);
  return messages.join(" ");
}
