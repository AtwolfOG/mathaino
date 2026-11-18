"use client";

import { useState } from "react";
import type { LearningItemView } from "../../application/learning-reader.ts";
import type { RemovalPolicy } from "../../application/learning-writer.ts";

export function LearningLibrary({
  initialItems,
  defaultRemovalPolicy,
}: {
  initialItems: LearningItemView[];
  defaultRemovalPolicy: RemovalPolicy;
}) {
  const [items, setItems] = useState(initialItems);
  const [choices, setChoices] = useState<Record<string, RemovalPolicy>>({});
  const [masteryChoices, setMasteryChoices] = useState<Record<string, string>>(
    {},
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function remove(item: LearningItemView) {
    const policy = choices[item.id] ?? defaultRemovalPolicy;
    setPendingId(item.id);
    setMessage("");
    try {
      const response = await fetch(`/api/learning-items/${item.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy }),
      });
      if (!response.ok) throw new Error("Removal failed");
      const result: unknown = await response.json();
      if (!isRemovalResult(result)) throw new Error("Invalid removal result");
      setItems((current) =>
        result.removed === "delete"
          ? current.filter(({ id }) => id !== item.id)
          : current.map((entry) =>
              entry.id === item.id ? { ...entry, archived: true } : entry,
            ),
      );
      setMessage(
        result.removed === "delete"
          ? `${reference(item)} deleted.`
          : `${reference(item)} archived.`,
      );
    } catch {
      setMessage(`${reference(item)} could not be removed. Try again.`);
    } finally {
      setPendingId(null);
    }
  }

  async function restore(item: LearningItemView) {
    setPendingId(item.id);
    setMessage("");
    try {
      const response = await fetch(`/api/learning-items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      if (!response.ok) throw new Error("Restore failed");
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, archived: false } : entry,
        ),
      );
      setMessage(`${reference(item)} restored.`);
    } catch {
      setMessage(`${reference(item)} could not be restored. Try again.`);
    } finally {
      setPendingId(null);
    }
  }

  async function saveMasteryThreshold(item: LearningItemView) {
    const selected = masteryChoices[item.id];
    const masteryThreshold = selected === "" ? null : Number(selected);
    setPendingId(item.id);
    setMessage("");
    try {
      const response = await fetch(`/api/learning-items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ masteryThreshold }),
      });
      if (!response.ok) throw new Error("Mastery requirement update failed");
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                masteryThreshold:
                  masteryThreshold ?? entry.defaultMasteryThreshold,
                usesDefaultMasteryThreshold: masteryThreshold === null,
              }
            : entry,
        ),
      );
      setMessage(`${reference(item)} mastery requirement saved.`);
    } catch {
      setMessage(
        `${reference(item)} mastery requirement could not be saved. Try again.`,
      );
    } finally {
      setPendingId(null);
    }
  }

  if (!items.length)
    return <p className="library-empty">Your learning library is empty.</p>;

  return (
    <>
      <ul className="library-items">
        {items.map((item) => {
          const label = reference(item);
          return (
            <li key={item.id} className={item.archived ? "is-archived" : ""}>
              <div className="library-item-heading">
                <h2>{label}</h2>
                <span
                  className={`learning-status learning-status-${item.status}`}
                >
                  {item.archived ? "Archived" : statusLabel(item.status)}
                </span>
              </div>
              <p>{item.text}</p>
              <div className="library-actions">
                {item.archived ? (
                  <button
                    type="button"
                    disabled={pendingId === item.id}
                    onClick={() => restore(item)}
                    aria-label={`Restore ${label}`}
                  >
                    Restore
                  </button>
                ) : (
                  <details>
                    <summary>Manage</summary>
                    <label>
                      Days to mastery for {label}
                      <select
                        value={
                          masteryChoices[item.id] ??
                          (item.usesDefaultMasteryThreshold
                            ? ""
                            : String(item.masteryThreshold))
                        }
                        onChange={(event) =>
                          setMasteryChoices((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">
                          Use account default ({item.defaultMasteryThreshold})
                        </option>
                        {Array.from(
                          { length: 30 },
                          (_, index) => index + 1,
                        ).map((days) => (
                          <option key={days} value={days}>
                            {days}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={pendingId === item.id}
                      onClick={() => saveMasteryThreshold(item)}
                    >
                      Save mastery days
                    </button>
                    <label>
                      Removal choice for {label}
                      <select
                        value={choices[item.id] ?? defaultRemovalPolicy}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [item.id]: event.target.value as RemovalPolicy,
                          }))
                        }
                      >
                        <option value="archive">
                          Archive and keep progress
                        </option>
                        <option value="delete">Delete progress</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={pendingId === item.id}
                      onClick={() => remove(item)}
                      aria-label={`Remove ${label}`}
                    >
                      Remove verse
                    </button>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="library-status" role="status" aria-live="polite">
        {message}
      </p>
    </>
  );
}

function reference(item: LearningItemView) {
  return `${item.bookName} ${item.chapter}:${item.verse}`;
}

function statusLabel(status: LearningItemView["status"]) {
  if (status === "review-due") return "Review due";
  return status === "mastered" ? "Mastered" : "Learning";
}

function isRemovalResult(value: unknown): value is { removed: RemovalPolicy } {
  return (
    typeof value === "object" &&
    value !== null &&
    "removed" in value &&
    (value.removed === "archive" || value.removed === "delete")
  );
}
