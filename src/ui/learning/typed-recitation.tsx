"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { RecitationResult } from "../../application/recitation.ts";
import type { WordDifference } from "../../domain/recitation-evaluation.ts";

export interface TypedRecitationProps {
  itemId: string;
  reference: string;
  verseText: string;
}

export function TypedRecitation({
  itemId,
  reference,
  verseText,
}: TypedRecitationProps) {
  const [text, setText] = useState("");
  const [operationId, setOperationId] = useState(createOperationId);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RecitationResult | null>(null);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) return;
    if (text.trim().length === 0) {
      setError("Type your recitation before submitting.");
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/recitation-attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, operationId, text }),
      });
      const body: unknown = await response.json();
      if (response.ok && isRecitationResult(body)) {
        setResult(body);
        setUncertain(false);
      } else if (response.status === 503) {
        setUncertain(true);
        setError(
          "The save outcome could not be confirmed. Try saving again with the same attempt.",
        );
      } else {
        setUncertain(false);
        setError(errorMessage(body) ?? "Recitation was not saved. Try again.");
      }
    } catch {
      setUncertain(true);
      setError(
        "The save outcome could not be confirmed. Try saving again with the same attempt.",
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

  function retry() {
    setText("");
    setResult(null);
    setError("");
    setUncertain(false);
    setOperationId(createOperationId());
    queueMicrotask(() => inputRef.current?.focus());
  }

  return (
    <div className="typed-recitation">
      <VerseReveal itemId={itemId} verseText={verseText} />
      <form className="recitation-form" onSubmit={submit}>
        <label htmlFor={`recitation-${itemId}`}>Type {reference}</label>
        <textarea
          ref={inputRef}
          id={`recitation-${itemId}`}
          aria-label={`Type ${reference}`}
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
                : "Check recitation"}
          </button>
          <small>Press Ctrl+Enter or Command+Enter to submit.</small>
        </div>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <RecitationFeedback
          result={result}
          headingRef={resultRef}
          onRetry={retry}
        />
      ) : null}
    </div>
  );
}

export function RecitationFeedback({
  result,
  headingRef,
  onRetry,
}: {
  result: RecitationResult;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onRetry: () => void;
}) {
  return (
    <section className="recitation-result" aria-label="Recitation result">
      <h3 ref={headingRef} tabIndex={-1}>
        {result.evaluation.passed ? "Passed" : "Keep practising"}
      </h3>
      <strong>{result.evaluation.accuracy}% accuracy</strong>
      {result.evaluation.differences.length === 0 ? (
        <p>No word differences.</p>
      ) : (
        <ul aria-label="Word differences">
          {result.evaluation.differences.map((difference, index) => (
            <li
              key={`${difference.type}-${difference.expectedIndex}-${difference.submittedIndex}-${index}`}
            >
              {differenceText(difference)}
            </li>
          ))}
        </ul>
      )}
      <p>
        {result.progress.mastered
          ? "Verse mastered."
          : `Mastery progress: ${result.progress.consecutiveDays} of ${result.progress.masteryThreshold} days`}
      </p>
      <p>
        Practice streak: {result.progress.practiceStreak}{" "}
        {result.progress.practiceStreak === 1 ? "day" : "days"}
      </p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}

export function VerseReveal({
  itemId,
  verseText,
}: Pick<TypedRecitationProps, "itemId" | "verseText">) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="verse-reveal">
      <button
        type="button"
        aria-expanded={revealed}
        aria-controls={`verse-text-${itemId}`}
        onClick={() => setRevealed((value) => !value)}
      >
        {revealed ? "Hide verse" : "Reveal verse"}
      </button>
      <p id={`verse-text-${itemId}`} hidden={!revealed}>
        {verseText}
      </p>
    </div>
  );
}

function createOperationId() {
  return crypto.randomUUID();
}

function differenceText(difference: WordDifference) {
  if (difference.type === "omission") return `Missing “${difference.expected}”`;
  if (difference.type === "insertion") return `Extra “${difference.submitted}”`;
  return `Expected “${difference.expected}”; typed “${difference.submitted}”`;
}

export function errorMessage(value: unknown) {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : null;
}

export function isRecitationResult(value: unknown): value is RecitationResult {
  if (typeof value !== "object" || value === null) return false;
  if (
    !("status" in value) ||
    (value.status !== "recorded" && value.status !== "duplicate") ||
    !("evaluation" in value) ||
    typeof value.evaluation !== "object" ||
    value.evaluation === null ||
    !("progress" in value) ||
    typeof value.progress !== "object" ||
    value.progress === null
  )
    return false;
  const evaluation = value.evaluation;
  const progress = value.progress;
  return (
    "accuracy" in evaluation &&
    typeof evaluation.accuracy === "number" &&
    "passed" in evaluation &&
    typeof evaluation.passed === "boolean" &&
    "differences" in evaluation &&
    Array.isArray(evaluation.differences) &&
    evaluation.differences.every(isWordDifference) &&
    "feedback" in evaluation &&
    typeof evaluation.feedback === "string" &&
    "normalizedExpected" in evaluation &&
    typeof evaluation.normalizedExpected === "string" &&
    "normalizedSubmitted" in evaluation &&
    typeof evaluation.normalizedSubmitted === "string" &&
    "consecutiveDays" in progress &&
    typeof progress.consecutiveDays === "number" &&
    "masteryThreshold" in progress &&
    typeof progress.masteryThreshold === "number" &&
    "mastered" in progress &&
    typeof progress.mastered === "boolean" &&
    "practiceStreak" in progress &&
    typeof progress.practiceStreak === "number"
  );
}

function isWordDifference(value: unknown): value is WordDifference {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value.type === "omission" ||
      value.type === "insertion" ||
      value.type === "substitution") &&
    "expected" in value &&
    (typeof value.expected === "string" || value.expected === null) &&
    "submitted" in value &&
    (typeof value.submitted === "string" || value.submitted === null) &&
    "expectedIndex" in value &&
    typeof value.expectedIndex === "number" &&
    "submittedIndex" in value &&
    typeof value.submittedIndex === "number"
  );
}
