import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  aliceId,
  asFixtureUser,
  bobId,
  expectDatabaseError,
  fixtureTime,
  insertUser,
  missingId,
  requireTables,
  withTestDatabase,
} from "../helpers/schema-database";

const tables = ["users", "auth_accounts", "auth_sessions"];
const tokenHash = "a".repeat(64);

test("identity records persist a provider-neutral account and hashed session", () =>
  withTestDatabase(async (tx) => {
    await requireTables(tx, tables);
    await insertUser(tx);
    await asFixtureUser(tx, aliceId, async (db) => {
      await db.execute(
        sql`insert into auth_accounts (user_id, provider, provider_account_id) values (${aliceId}, 'fixture-provider', 'account-1')`,
      );
      await db.execute(
        sql`insert into auth_sessions (user_id, token_hash, created_at, expires_at) values (${aliceId}, ${tokenHash}, ${fixtureTime}, '2027-01-01T12:00:00Z')`,
      );
      const result = await db.execute(
        sql`select a.provider, s.token_hash from users u join auth_accounts a on a.user_id = u.id join auth_sessions s on s.user_id = u.id`,
      );
      expect(result.rows).toEqual([
        { provider: "fixture-provider", token_hash: tokenHash },
      ]);
    });
  }));

test("a provider account cannot be linked to two users", () =>
  withTestDatabase(async (tx) => {
    await requireTables(tx, tables);
    await insertUser(tx);
    await insertUser(tx, bobId);
    await asFixtureUser(tx, aliceId, (db) =>
      db.execute(
        sql`insert into auth_accounts (user_id, provider, provider_account_id) values (${aliceId}, 'fixture', 'same-account')`,
      ),
    );
    await expectDatabaseError(
      asFixtureUser(tx, bobId, (db) =>
        db.execute(
          sql`insert into auth_accounts (user_id, provider, provider_account_id) values (${bobId}, 'fixture', 'same-account')`,
        ),
      ),
      "23505",
    );
  }));

test("session hashes are unique", () =>
  withTestDatabase(async (tx) => {
    await requireTables(tx, tables);
    await insertUser(tx);
    await asFixtureUser(tx, aliceId, (db) =>
      db.execute(
        sql`insert into auth_sessions (user_id, token_hash, created_at, expires_at) values (${aliceId}, ${tokenHash}, ${fixtureTime}, '2027-01-01T12:00:00Z')`,
      ),
    );
    await expectDatabaseError(
      asFixtureUser(tx, aliceId, (db) =>
        db.execute(
          sql`insert into auth_sessions (user_id, token_hash, created_at, expires_at) values (${aliceId}, ${tokenHash}, ${fixtureTime}, '2027-01-01T12:00:00Z')`,
        ),
      ),
      "23505",
    );
  }));

test("authentication records cannot reference a missing user", () =>
  withTestDatabase(async (tx) => {
    await requireTables(tx, tables);
    await expectDatabaseError(
      asFixtureUser(tx, missingId, (db) =>
        db.execute(
          sql`insert into auth_accounts (user_id, provider, provider_account_id) values (${missingId}, 'fixture', 'missing-user')`,
        ),
      ),
      "23503",
    );
    await expectDatabaseError(
      asFixtureUser(tx, missingId, (db) =>
        db.execute(
          sql`insert into auth_sessions (user_id, token_hash, created_at, expires_at) values (${missingId}, ${tokenHash}, ${fixtureTime}, '2027-01-01T12:00:00Z')`,
        ),
      ),
      "23503",
    );
  }));

test("session storage rejects raw tokens and impossible lifetimes", () =>
  withTestDatabase(async (tx) => {
    await requireTables(tx, tables);
    await insertUser(tx);
    await expectDatabaseError(
      asFixtureUser(tx, aliceId, (db) =>
        db.execute(
          sql`insert into auth_sessions (user_id, token_hash, created_at, expires_at) values (${aliceId}, 'not-a-sha256-digest', ${fixtureTime}, '2027-01-01T12:00:00Z')`,
        ),
      ),
      "23514",
    );
    await expectDatabaseError(
      asFixtureUser(tx, aliceId, (db) =>
        db.execute(
          sql`insert into auth_sessions (user_id, token_hash, created_at, expires_at) values (${aliceId}, ${tokenHash}, ${fixtureTime}, ${fixtureTime})`,
        ),
      ),
      "23514",
    );
  }));

test("deleting a user cascades to its authentication records", () =>
  withTestDatabase(async (tx) => {
    await requireTables(tx, tables);
    await insertUser(tx);
    await asFixtureUser(tx, aliceId, async (db) => {
      await db.execute(
        sql`insert into auth_accounts (user_id, provider, provider_account_id) values (${aliceId}, 'fixture', 'account-1')`,
      );
      await db.execute(
        sql`insert into auth_sessions (user_id, token_hash, created_at, expires_at) values (${aliceId}, ${tokenHash}, ${fixtureTime}, '2027-01-01T12:00:00Z')`,
      );
      await db.execute(sql`delete from users where id = ${aliceId}`);
      expect(
        (await db.execute(sql`select id from auth_accounts`)).rows,
      ).toEqual([]);
      expect(
        (await db.execute(sql`select id from auth_sessions`)).rows,
      ).toEqual([]);
    });
  }));
