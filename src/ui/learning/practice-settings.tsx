"use client";

import { useState, type FormEvent } from "react";
import type { PracticeSettingsView } from "../../application/practice-settings.ts";

export function PracticeSettingsForm({
  initialSettings,
  timeZones,
}: {
  initialSettings: PracticeSettingsView;
  timeZones: readonly string[];
}) {
  const [masteryThreshold, setMasteryThreshold] = useState(
    initialSettings.masteryThreshold,
  );
  const [timeZone, setTimeZone] = useState(initialSettings.timeZone);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/practice-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ masteryThreshold, timeZone }),
      });
      setMessage(
        response.ok
          ? "Practice settings saved."
          : "Practice settings were not saved.",
      );
    } catch {
      setMessage("Practice settings were not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="settings-form practice-settings-form" onSubmit={save}>
      <fieldset>
        <legend>Learning rhythm</legend>
        <label>
          <span>
            <strong>Days to mastery</strong>
            <small>Consecutive successful days required for each verse.</small>
          </span>
          <input
            aria-label="Days to mastery"
            type="number"
            min="1"
            max="30"
            required
            value={masteryThreshold}
            onChange={(event) =>
              setMasteryThreshold(event.target.valueAsNumber)
            }
          />
        </label>
        <label>
          <span>
            <strong>Practice timezone</strong>
            <small>Used to assign attempts to your local calendar day.</small>
          </span>
          <select
            aria-label="Practice timezone"
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
          >
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <button type="submit" disabled={pending}>
        Save practice settings
      </button>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
