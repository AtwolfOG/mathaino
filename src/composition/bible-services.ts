import "server-only";
import { createDatabase } from "../infrastructure/database/client.ts";
import { createBibleReader } from "../infrastructure/database/bible-reader.ts";

function createBibleServices() {
  const connection = createDatabase(process.env.DATABASE_URL ?? "");
  return { bible: createBibleReader(connection.db) };
}

let services: ReturnType<typeof createBibleServices> | undefined;

export function getBibleServices() {
  services ??= createBibleServices();
  return services;
}
