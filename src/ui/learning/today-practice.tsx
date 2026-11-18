"use client";

import Link from "next/link";
import { useState } from "react";
import type { LearningQueueView } from "../../application/learning-queue.ts";
import { RecitationPractice } from "./recitation-practice.tsx";
import type { ReviewResult } from "../../application/review.ts";
import { TypedReview } from "./typed-review.tsx";
import type { VoiceProviderSet } from "./voice-recitation.tsx";

export function TodayPractice({
  initialQueue,
  localWhisperEnabled = false,
  createVoiceProviders,
}: {
  initialQueue: LearningQueueView;
  localWhisperEnabled?: boolean;
  createVoiceProviders?: () => VoiceProviderSet;
}) {
  const [queue, setQueue] = useState(initialQueue);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function move(itemId: string | null) {
    if (!itemId || pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/learning-queue", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, expectedVersion: queue.version }),
      });
      const body: unknown = await response.json();
      if ((response.ok || response.status === 409) && isQueueResponse(body)) {
        setQueue(body.queue);
        if (response.status === 409)
          setMessage(
            "Your queue changed elsewhere. Current progress reloaded.",
          );
      } else {
        setMessage("Progress could not be saved. Try again.");
      }
    } catch {
      setMessage("Progress could not be saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function refreshAfterReview(result: ReviewResult) {
    const interval = result.schedule.intervalDays;
    setMessage(
      `Review saved. Next review in ${interval} ${interval === 1 ? "day" : "days"}.`,
    );
    try {
      const response = await fetch("/api/learning-queue");
      const body: unknown = await response.json();
      if (response.ok && isQueueResponse(body)) setQueue(body.queue);
      else
        setMessage(
          "Review saved, but today's queue could not be refreshed. Reload the page.",
        );
    } catch {
      setMessage(
        "Review saved, but today's queue could not be refreshed. Reload the page.",
      );
    }
  }

  if (!queue.current)
    return (
      <section className="today-empty" aria-labelledby="empty-queue-heading">
        <h2 id="empty-queue-heading">Nothing queued today</h2>
        <p>Choose a verse in the Bible reader to begin learning it.</p>
        <Link href="/bible">Choose verses</Link>
        <p className="practice-status" role="status" aria-live="polite">
          {message}
        </p>
      </section>
    );

  const item = queue.current;
  const remainingText =
    queue.remaining === 0
      ? "No verses remaining"
      : `${queue.remaining} ${queue.remaining === 1 ? "verse" : "verses"} remaining`;
  return (
    <section className="today-practice" aria-labelledby="today-verse-heading">
      <div className="today-progress">
        <div>
          <strong>
            {queue.position} of {queue.total}
          </strong>
          <span>{remainingText}</span>
        </div>
        <progress
          value={queue.position}
          max={queue.total}
          aria-label="Queue progress"
        />
      </div>
      <article className="practice-verse">
        <span className={`learning-status learning-status-${item.status}`}>
          {statusLabel(item.status)}
        </span>
        <h2 id="today-verse-heading">
          {item.bookName} {item.chapter}:{item.verse}
        </h2>
        {item.status === "learning" ? (
          <RecitationPractice
            key={item.id}
            itemId={item.id}
            reference={`${item.bookName} ${item.chapter}:${item.verse}`}
            verseText={item.text}
            localWhisperEnabled={localWhisperEnabled}
            createVoiceProviders={createVoiceProviders}
          />
        ) : (
          <TypedReview
            key={item.id}
            itemId={item.id}
            reference={`${item.bookName} ${item.chapter}:${item.verse}`}
            verseText={item.text}
            onSaved={(result) => void refreshAfterReview(result)}
          />
        )}
      </article>
      <nav className="queue-navigation" aria-label="Learning queue">
        <button
          type="button"
          disabled={!queue.previousId || pending}
          onClick={() => move(queue.previousId)}
          aria-label="Previous verse"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!queue.nextId || pending}
          onClick={() => move(queue.nextId)}
          aria-label="Next verse"
        >
          Next
        </button>
      </nav>
      <p className="practice-status" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}

function statusLabel(status: "learning" | "review-due") {
  return status === "learning" ? "Learning" : "Review due";
}

function isQueueResponse(
  value: unknown,
): value is { queue: LearningQueueView } {
  return (
    typeof value === "object" &&
    value !== null &&
    "queue" in value &&
    typeof value.queue === "object" &&
    value.queue !== null &&
    "version" in value.queue &&
    typeof value.queue.version === "number"
  );
}
