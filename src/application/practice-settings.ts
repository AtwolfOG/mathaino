import type { AuthenticationContext } from "./authentication-context.ts";

export interface PracticeSettingsView {
  masteryThreshold: number;
  timeZone: string;
}

export interface PracticeSettings {
  read(authentication: AuthenticationContext): Promise<PracticeSettingsView>;
  update(
    authentication: AuthenticationContext,
    settings: PracticeSettingsView,
  ): Promise<PracticeSettingsView>;
}

export class InvalidPracticeSettingsError extends Error {}

export function isValidIanaTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function validatePracticeSettings(
  value: PracticeSettingsView,
): PracticeSettingsView {
  if (
    !Number.isSafeInteger(value.masteryThreshold) ||
    value.masteryThreshold < 1 ||
    value.masteryThreshold > 30 ||
    !isValidIanaTimeZone(value.timeZone)
  )
    throw new InvalidPracticeSettingsError("Invalid practice settings.");
  return value;
}
