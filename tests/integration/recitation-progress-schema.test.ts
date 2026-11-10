import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  aliceId,
  asFixtureUser,
  insertUser,
  requireTables,
  withTestDatabase,
} from "../helpers/schema-database";

test("learning preferences store typed-practice defaults and successful-day facts", () =>
  withTestDatabase(async (db) => {
    await requireTables(db, ["learning_success_days"]);
    await insertUser(db);
    await asFixtureUser(db, aliceId, async (tx) => {
      await tx.execute(
        sql`insert into learning_preferences (user_id) values (${aliceId})`,
      );
      const preferences = await tx.execute(
        sql`select mastery_threshold, time_zone from learning_preferences`,
      );
      expect(preferences.rows).toEqual([
        { mastery_threshold: 3, time_zone: "Etc/UTC" },
      ]);
    });
  }));
