import { sql, TransactionRollbackError } from "drizzle-orm";
import { expect } from "vitest";
import { createDatabase } from "@/infrastructure/database/client";
import { applyMigrations } from "@/infrastructure/database/migrate";
import { getTestDatabaseUrl } from "./database-url";

type Database = ReturnType<typeof createDatabase>["db"];
export type TestTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export const aliceId = "00000000-0000-4000-8000-000000000001";
export const bobId = "00000000-0000-4000-8000-000000000002";
export const missingId = "00000000-0000-4000-8000-999999999999";
export const fixtureTime = "2026-01-01T12:00:00Z";
export const verseId = "10000000-0000-4000-8000-000000000001";
export const itemId = "20000000-0000-4000-8000-000000000001";
export const otherItemId = "20000000-0000-4000-8000-000000000002";
export const attemptId = "30000000-0000-4000-8000-000000000001";
export const otherAttemptId = "30000000-0000-4000-8000-000000000002";
export const operationId = "40000000-0000-4000-8000-000000000001";

export async function withTestDatabase(
  run: (transaction: TestTransaction) => Promise<void>,
) {
  const connection = createDatabase(
    getTestDatabaseUrl(process.env.TEST_DATABASE_URL),
  );
  try {
    // Only the explicit isolated store is migrated. No reset/truncate is needed.
    await applyMigrations(connection.db);

    let finished = false;
    try {
      await connection.db.transaction(async (transaction) => {
        await run(transaction);
        finished = true;
        transaction.rollback();
      });
    } catch (error) {
      if (!finished || !(error instanceof TransactionRollbackError))
        throw error;
    }
  } finally {
    await connection.close();
  }
}

export async function requireTables(
  transaction: TestTransaction,
  names: string[],
) {
  const result = await transaction.execute(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in (${sql.join(
      names.map((name) => sql`${name}`),
      sql`, `,
    )})
    order by table_name
  `);
  expect(result.rows.map((row) => row.table_name)).toEqual([...names].sort());
}

// Fixture setup deliberately exercises the same PostgreSQL context contract as
// RLS queries. It does not simulate a login or accept browser-provided identity.
export async function asFixtureUser<T>(
  transaction: TestTransaction,
  userId: string,
  run: (scoped: TestTransaction) => Promise<T>,
): Promise<T> {
  return transaction.transaction(async (scoped) => {
    const result = await scoped.execute(
      sql`select current_setting('mathaino.user_id', true) as previous_id`,
    );
    const previous = result.rows[0]?.previous_id;
    await scoped.execute(
      sql`select set_config('mathaino.user_id', ${userId}, true)`,
    );
    const value = await run(scoped);
    await scoped.execute(
      sql`select set_config('mathaino.user_id', ${typeof previous === "string" ? previous : ""}, true)`,
    );
    return value;
  });
}

export async function insertUser(
  transaction: TestTransaction,
  userId = aliceId,
) {
  await asFixtureUser(transaction, userId, (scoped) =>
    scoped.execute(sql`
    insert into users (id, display_name, created_at, updated_at)
    values (${userId}, 'Fixture learner', ${fixtureTime}, ${fixtureTime})
  `),
  );
}

export function expectDatabaseError(operation: Promise<unknown>, code: string) {
  return expect(operation).rejects.toMatchObject({ cause: { code } });
}

export async function insertReference(transaction: TestTransaction) {
  await transaction.execute(
    sql`insert into bible_books (translation_id, id, name, created_at, updated_at) values ('fixture-a', 'fixture(book)', 'Fixture Book', ${fixtureTime}, ${fixtureTime})`,
  );
  await transaction.execute(
    sql`insert into bible_chapters (translation_id, book_id, id, created_at, updated_at) values ('fixture-a', 'fixture(book)', '10', ${fixtureTime}, ${fixtureTime})`,
  );
  await transaction.execute(
    sql`insert into bible_verses (id, translation_id, book_id, chapter, verse, text, created_at, updated_at) values (${verseId}, 'fixture-a', 'fixture(book)', '10', '2a', 'Fixture text. ¶ annotation', ${fixtureTime}, ${fixtureTime})`,
  );
}

export async function insertLearning(
  transaction: TestTransaction,
  owner = aliceId,
  id = itemId,
  state: "learning" | "mastered" = "learning",
) {
  await asFixtureUser(transaction, owner, (db) =>
    db.execute(sql`
    insert into learning_items (id, user_id, verse_id, state, mastered_at, created_at, updated_at)
    values (${id}, ${owner}, ${verseId}, ${state},
      case when ${state} = 'mastered' then ${fixtureTime}::timestamptz else null end,
      ${fixtureTime}, ${fixtureTime})
  `),
  );
}

export async function insertAttempt(
  transaction: TestTransaction,
  owner = aliceId,
  learningItem = itemId,
  id = attemptId,
  operation = operationId,
) {
  await asFixtureUser(transaction, owner, (db) =>
    db.execute(sql`
    insert into practice_attempts
      (id, user_id, learning_item_id, operation_id, request_hash, mode, purpose,
       outcome, practiced_at, practice_date, time_zone, assessment_policy, day_policy)
    values (${id}, ${owner}, ${learningItem}, ${operation}, ${"b".repeat(64)},
      'typing', 'learning', 'success', ${fixtureTime}, '2026-01-01', 'Etc/UTC',
      'fixture-assessment-v1', 'fixture-day-v1')
  `),
  );
}

export async function insertCompletion(
  transaction: TestTransaction,
  owner = aliceId,
  source = attemptId,
  date = "2026-01-01",
) {
  await asFixtureUser(transaction, owner, (db) =>
    db.execute(sql`
    insert into daily_practice_completions (user_id, practice_date, source_attempt_id, time_zone, day_policy)
    values (${owner}, ${date}, ${source}, 'Etc/UTC', 'fixture-day-v1')
  `),
  );
}

export async function insertSchedule(
  transaction: TestTransaction,
  owner = aliceId,
  learningItem = itemId,
) {
  await asFixtureUser(transaction, owner, (db) =>
    db.execute(sql`
    insert into review_schedules (user_id, learning_item_id, next_due_at, policy_id, created_at, updated_at)
    values (${owner}, ${learningItem}, '2026-01-08T12:00:00Z', 'fixture-review-v1', ${fixtureTime}, ${fixtureTime})
  `),
  );
}
