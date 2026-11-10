import "server-only";
import { eq } from "drizzle-orm";
import {
  validatePracticeSettings,
  type PracticeSettings,
} from "../../application/practice-settings.ts";
import type { TransactionHost } from "./client.ts";
import { learningPreferences } from "./schema.ts";
import { withUserDatabase } from "./with-user.ts";

export function createPracticeSettings(
  database: TransactionHost,
): PracticeSettings {
  return {
    read: async (authentication) => {
      const userId = await requireUser(authentication);
      return withUserDatabase(database, authentication, async (transaction) => {
        const rows = await transaction
          .select({
            masteryThreshold: learningPreferences.masteryThreshold,
            timeZone: learningPreferences.timeZone,
          })
          .from(learningPreferences)
          .where(eq(learningPreferences.userId, userId))
          .limit(1);
        return validatePracticeSettings(
          rows[0] ?? { masteryThreshold: 3, timeZone: "Etc/UTC" },
        );
      });
    },
    update: async (authentication, settings) => {
      const valid = validatePracticeSettings(settings);
      const userId = await requireUser(authentication);
      return withUserDatabase(database, authentication, async (transaction) => {
        const rows = await transaction
          .insert(learningPreferences)
          .values({ userId, ...valid })
          .onConflictDoUpdate({
            target: learningPreferences.userId,
            set: { ...valid, updatedAt: new Date() },
          })
          .returning({
            masteryThreshold: learningPreferences.masteryThreshold,
            timeZone: learningPreferences.timeZone,
          });
        const saved = rows[0];
        if (!saved) throw new Error("Practice settings were not saved.");
        return saved;
      });
    },
  };
}

async function requireUser(authentication: {
  getUserId(): Promise<string | null>;
}) {
  const userId = await authentication.getUserId();
  if (!userId) throw new Error("Authentication required.");
  return userId;
}
