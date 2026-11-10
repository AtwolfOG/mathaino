import { expect, test } from "vitest";
import { InvalidPracticeSettingsError } from "@/application/practice-settings";
import { createPracticeSettings } from "@/infrastructure/database/practice-settings";
import {
  aliceId,
  bobId,
  insertUser,
  withTestDatabase,
} from "../helpers/schema-database";

const auth = (userId: string | null) => ({ getUserId: async () => userId });

test("practice settings persist per owner with safe defaults", () =>
  withTestDatabase(async (db) => {
    await insertUser(db);
    await insertUser(db, bobId);
    const settings = createPracticeSettings(db);
    await expect(settings.read(auth(aliceId))).resolves.toEqual({
      masteryThreshold: 3,
      timeZone: "Etc/UTC",
    });
    await expect(
      settings.update(auth(aliceId), {
        masteryThreshold: 7,
        timeZone: "America/New_York",
      }),
    ).resolves.toEqual({
      masteryThreshold: 7,
      timeZone: "America/New_York",
    });
    await expect(settings.read(auth(aliceId))).resolves.toEqual({
      masteryThreshold: 7,
      timeZone: "America/New_York",
    });
    await expect(settings.read(auth(bobId))).resolves.toEqual({
      masteryThreshold: 3,
      timeZone: "Etc/UTC",
    });
  }));

test.each([
  { masteryThreshold: 0, timeZone: "Etc/UTC" },
  { masteryThreshold: 31, timeZone: "Etc/UTC" },
  { masteryThreshold: 3.5, timeZone: "Etc/UTC" },
  { masteryThreshold: 3, timeZone: "Not/AZone" },
])("rejects invalid practice settings", (value) =>
  withTestDatabase(async (db) => {
    await insertUser(db);
    await expect(
      createPracticeSettings(db).update(auth(aliceId), value),
    ).rejects.toBeInstanceOf(InvalidPracticeSettingsError);
  }),
);
