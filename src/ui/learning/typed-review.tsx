"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ReviewResult } from "../../application/review.ts";
import { errorMessage, VerseReveal } from "./typed-recitation.tsx";

export function TypedReview({
  itemId,
  reference,
  verseText,
  onSaved,
}: {
  itemId: string;
  reference: string;
  verseText: string;
  onSaved: (result: ReviewResult) => void;
}) {
  const [text, setText] = useState("");
  const [operationId] = useState(createOperationId);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) return;
    if (text.trim().length === 0) {
      setError("Type your review before submitting.");
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/review-attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, operationId, text }),
      });
      const body: unknown = await response.json();
      if (response.ok && isReviewResult(body)) {
        setResult(body);
        setUncertain(false);
        onSaved(body);
      } else if (response.status === 503) {
        setUncertain(true);
        setError(
          "The save outcome could not be confirmed. Try saving again with the same review.",
        );
      } else {
        setUncertain(false);
        setError(errorMessage(body) ?? "Review was not saved. Try again.");
      }
    } catch {
      setUncertain(true);
      setError(
        "The save outcome could not be confirmed. Try saving again with the same review.",
      );
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="typed-recitation typed-review">
      <VerseReveal itemId={itemId} verseText={verseText} />
      <form className="recitation-form" onSubmit={submit}>
        <label htmlFor={`review-${itemId}`}>Review {reference}</label>
        <textarea
          ref={inputRef}
          id={`review-${itemId}`}
          aria-label={`Review ${reference}`}
          value={text}
          maxLength={10_000}
          rows={7}
          disabled={pending || result !== null}
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="recitation-actions">
          <button type="submit" disabled={pending || result !== null}>
            {pending
              ? "Checking…"
              : uncertain
                ? "Try saving again"
                : "Check review"}
          </button>
          <small>Press Ctrl+Enter or Command+Enter to submit.</small>
        </div>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <section className="recitation-result" aria-label="Review result">
          <h3 tabIndex={-1}>
            {result.evaluation.passed ? "Review passed" : "Review saved"}
          </h3>
          <strong>{result.evaluation.accuracy}% accuracy</strong>
          <p>{result.evaluation.feedback}</p>
          <p>
            Next review in {result.schedule.intervalDays}{" "}
            {result.schedule.intervalDays === 1 ? "day" : "days"}.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function createOperationId() {
  return crypto.randomUUID();
}

function isReviewResult(value: unknown): value is ReviewResult {
  if (typeof value !== "object" || value === null) return false;
  if (
    !("status" in value) ||
    (value.status !== "recorded" && value.status !== "duplicate") ||
    !("evaluation" in value) ||
    typeof value.evaluation !== "object" ||
    value.evaluation === null ||
    !("schedule" in value) ||
    typeof value.schedule !== "object" ||
    value.schedule === null
  )
    return false;
  const evaluation = value.evaluation;
  const schedule = value.schedule;
  return (
    "passed" in evaluation &&
    typeof evaluation.passed === "boolean" &&
    "accuracy" in evaluation &&
    typeof evaluation.accuracy === "number" &&
    Number.isFinite(evaluation.accuracy) &&
    "feedback" in evaluation &&
    typeof evaluation.feedback === "string" &&
    "stage" in schedule &&
    typeof schedule.stage === "number" &&
    Number.isInteger(schedule.stage) &&
    schedule.stage >= 0 &&
    schedule.stage <= 6 &&
    "intervalDays" in schedule &&
    typeof schedule.intervalDays === "number" &&
    Number.isInteger(schedule.intervalDays) &&
    schedule.intervalDays > 0 &&
    "nextDueAt" in schedule &&
    typeof schedule.nextDueAt === "string" &&
    Number.isFinite(Date.parse(schedule.nextDueAt))
  );
}
