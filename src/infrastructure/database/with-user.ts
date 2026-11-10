import "server-only";
import { sql } from "drizzle-orm";
import type { AuthenticationContext } from "../../application/authentication-context.ts";
import type { DatabaseTransaction, TransactionHost } from "./client.ts";

export async function withUserDatabase<T>(
  database: TransactionHost,
  authentication: AuthenticationContext,
  run: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  const userId = await authentication.getUserId();
  if (userId === null) throw new Error("Authentication required.");
  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    throw new Error("Invalid authenticated user identifier.");
  }

  return database.transaction(async (transaction) => {
    const result = await transaction.execute(
      sql`select current_setting('mathaino.user_id', true) as previous_id`,
    );
    const previous = result.rows[0]?.previous_id;
    await transaction.execute(
      sql`select set_config('mathaino.user_id', ${userId}, true)`,
    );
    const value = await run(transaction);
    // Supports nested scopes; transaction rollback restores context on errors.
    await transaction.execute(
      sql`select set_config('mathaino.user_id', ${typeof previous === "string" ? previous : ""}, true)`,
    );
    return value;
  });
}
