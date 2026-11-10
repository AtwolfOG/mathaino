"use client";

import { useState, type FormEvent } from "react";
import type { RemovalPolicy } from "../../application/learning-writer.ts";

export function LearningSettings({
  initialPolicy,
}: {
  initialPolicy: RemovalPolicy;
}) {
  const [policy, setPolicy] = useState(initialPolicy);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/learning-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ removalPolicy: policy }),
      });
      setMessage(
        response.ok ? "Preference saved." : "Preference was not saved.",
      );
    } catch {
      setMessage("Preference was not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={save}>
      <fieldset>
        <legend>Default when removing a verse</legend>
        <label>
          <input
            type="radio"
            name="removal-policy"
            value="archive"
            checked={policy === "archive"}
            onChange={() => setPolicy("archive")}
          />
          <span>
            <strong>Archive and keep progress</strong>
            <small>The verse can be restored from your library.</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="removal-policy"
            value="delete"
            checked={policy === "delete"}
            onChange={() => setPolicy("delete")}
            aria-label="Delete progress"
          />
          <span>
            <strong>Delete progress</strong>
            <small>Adding the verse again will start fresh.</small>
          </span>
        </label>
      </fieldset>
      <button type="submit" disabled={pending}>
        Save preference
      </button>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
