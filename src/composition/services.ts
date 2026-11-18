import "server-only";
import { sql } from "drizzle-orm";
import { readAuthEnvironment } from "../infrastructure/config/auth-environment.ts";
import { createDatabase } from "../infrastructure/database/client.ts";
import { createAuthentication } from "../infrastructure/authentication/service.ts";
import { createLearningReader } from "../infrastructure/database/learning-reader.ts";
import { createLearningWriter } from "../infrastructure/database/learning-writer.ts";
import { createLearningQueue } from "../infrastructure/database/learning-queue.ts";
import { createRecitationAttemptStore } from "../infrastructure/database/recitation.ts";
import { createRecitationService } from "../application/recitation.ts";
import { createPracticeSettings } from "../infrastructure/database/practice-settings.ts";
import { createReviewAttemptStore } from "../infrastructure/database/review.ts";
import { createReviewService } from "../application/review.ts";
import { readLocalWhisperEnvironment } from "../infrastructure/config/local-whisper-environment.ts";
import { createLocalWhisperTranscriber } from "../infrastructure/transcription/local-whisper-server.ts";

async function createServices() {
  const config = readAuthEnvironment(process.env);
  const application = createDatabase(config.databaseURL);
  const authentication = createDatabase(config.authDatabaseURL);
  try {
    const query = sql`select current_database() as database_name, current_user as role_name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    const appRole = (await application.db.execute(query)).rows[0];
    const authRole = (await authentication.db.execute(query)).rows[0];
    if (
      appRole?.rolsuper !== false ||
      appRole.rolbypassrls !== false ||
      appRole.role_name === "mathaino_auth" ||
      authRole?.rolsuper !== false ||
      authRole.rolbypassrls !== false ||
      authRole.role_name !== "mathaino_auth" ||
      appRole.database_name !== authRole.database_name
    )
      throw new Error(
        "Authentication requires separate non-bypass application and auth roles in the same database.",
      );
    return {
      auth: createAuthentication(authentication.db, config),
      learning: createLearningReader(application.db),
      learningWriter: createLearningWriter(application.db),
      learningQueue: createLearningQueue(application.db),
      recitation: createRecitationService(
        createRecitationAttemptStore(application.db),
      ),
      review: createReviewService(createReviewAttemptStore(application.db)),
      practiceSettings: createPracticeSettings(application.db),
      authOrigin: config.baseURL,
    };
  } catch (error) {
    await authentication.close();
    await application.close();
    throw error;
  }
}

let services: ReturnType<typeof createServices> | undefined;
export function getServices() {
  services ??= createServices().catch((error: unknown) => {
    services = undefined;
    throw error;
  });
  return services;
}

export async function getLocalWhisperServices() {
  const config = readLocalWhisperEnvironment(process.env);
  if (!config.enabled) return { enabled: false as const };
  const base = await getServices();
  return {
    enabled: true as const,
    auth: base.auth,
    authOrigin: base.authOrigin,
    transcriber: createLocalWhisperTranscriber(config),
  };
}
