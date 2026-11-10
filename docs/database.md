# PostgreSQL schema and operations

The schema is in `src/infrastructure/database/schema.ts`. Reviewable Drizzle SQL
migrations and snapshots are in `drizzle/`. This is persistence infrastructure
for the [domain model](architecture.md). Authentication flows are implemented by
[Better Auth](authentication.md); mastery, streak qualification, transcription,
and scheduling algorithms remain separate.

## Confirmed storage choices

The initial schema used provider-neutral identities and token digests. During
authentication integration the user approved Better Auth email/password and its
native opaque-token session model; existing digests remain unchanged. Review due
values are timezone-aware instants. Remaining product decisions are documented
in requirements and the authentication guide.

User identity remains an internal UUID. New email identities are unique, and
passwords use Better Auth's built-in scrypt. Native sessions have an opaque token;
legacy rows retain their 64-character digest. An XOR constraint requires exactly
one representation. Raw passwords are never stored. The maintained library owns
token generation, signing, verification, expiry, and revocation.

## Tables and relationships

| Table                        | Keys and important data                                                                                                       | Relationships / constraints                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `users`                      | UUID primary key; display name, optional canonical email, verification status                                                 | Root of the private data graph; legacy unknown email remains NULL                       |
| `auth_accounts`              | UUID key; unique `(provider, provider_account_id)`                                                                            | Owner FK to users; nonempty provider and external ID                                    |
| `auth_sessions`              | UUID key; unique native token or legacy digest; explicit expiry                                                               | Owner FK; exactly one credential representation; lifetime check                         |
| `auth_verifications`         | UUID key; identifier/value/expiry and audit timestamps                                                                        | Forced RLS permits only the dedicated auth service                                      |
| `auth_rate_limits`           | UUID key; unique library key, count and epoch-millisecond last request                                                        | Forced service-only RLS; library-managed atomic throttling                              |
| `bible_books`                | Composite key `(translation_id, id)`; display name; optional positive order unique per translation                            | Import profiles assign order; unknown legacy values remain NULL                         |
| `bible_chapters`             | Composite key `(translation_id, book_id, id)`; optional positive order unique per book                                        | Composite FK to its book; generic text identifiers                                      |
| `bible_verses`               | UUID key; unique `(translation_id, book_id, chapter, verse)`; original text                                                   | Composite FKs to its book and chapter in the same translation                           |
| `learning_items`             | UUID key; unique `(user_id, verse_id)`; state, mastery timestamp, stable queue order, optional archive instant                | User/verse FKs; `learning` or `mastered`; timestamp must agree with state               |
| `learning_preferences`       | User primary key; removal default, mastery threshold, IANA zone, optional current item, optimistic queue version              | Owner/current-item composite FK prevents cross-user cursors                             |
| `practice_attempts`          | UUID key; unique `(user_id, operation_id)`; request digest, mode, purpose, outcome, practice instant/date/zone and policy IDs | Composite owner/item FK; only typing/voice, learning/review, and success/failure values |
| `learning_success_days`      | Composite key `(user_id, learning_item_id, practice_date)`; successful attempt evidence and accepted zone/policy              | Composite FK ties the fact to the same owner, item, attempt, and date                   |
| `daily_practice_completions` | Composite key `(user_id, practice_date)`; evidence attempt, zone and day policy                                               | Composite FK requires an attempt belonging to that owner on that date                   |
| `review_schedules`           | Learning-item primary key; explicit next-due instant, optional last-reviewed instant, policy ID                               | Composite FK requires the same owner and a mastered learning item                       |

User/reference/auth records use `timestamptz` audit times; operational rate counters
use the library-required epoch milliseconds. Mutable record tables
also have `updated_at`, refreshed by a database trigger even for direct SQL.
Attempts and day completions are recorded facts with creation timestamps; there
is no misleading automatically maintained update time on those tables.

Calendar dates use PostgreSQL `date`; chapter and verse identifiers use nonempty
text. Source text and annotations are never trimmed or normalised during storage.
Nonempty checks validate without modifying the supplied values. PostgreSQL UUID
generation uses the built-in `gen_random_uuid()`; no extension is required.

### Progress facts and typed-practice policies

Successful-day and streak counters are derived from accepted facts under approved
policies, not stored as competing mutable authorities. Attempts preserve explicit
assessment/day policy identifiers and provided time context. They do not calculate
which day qualifies or validate a future policy's timezone-selection rules.
Daily completion represents a qualifying account-wide day; it is not a separate
successful-day counter for each verse. Typed practice adds an immutable
owner/item/date successful-day fact backed by the successful attempt. Consecutive
progress is derived from those facts rather than maintained as a competing count.

Technical failures are not stored as assessed failures or successes. For typed
learning, a success seals verse-day credit and any persisted assessment qualifies
the account day. Review failure and demotion remain unresolved.

Schedules require an explicit due instant and policy ID, with no interval default.
The constant `learning_state = 'mastered'` participates in a composite FK. If a
future approved operation demotes an item, it must remove the schedule before
changing state, atomically in the same transaction. This constraint does not
choose a demotion policy. Review attempts use `purpose = 'review'`; no duplicate
review-outcome table is needed for the same assessed fact.

## Foreign keys, indexes, and deletion behaviour

- User deletion cascades to auth records and learning items. Learning-item
  deletion cascades to its attempts and review schedule; deleting an evidence
  attempt cascades to its daily completion. These are database cleanup mechanics,
  not a newly implemented account/item deletion or retention workflow.
- A book with verses cannot be deleted. A verse referenced by learning cannot be
  deleted. Shared catalogue deletion never silently destroys private progress.
- Composite owner keys prevent cross-user child records even if a server bug
  supplies a mismatched owner/item or owner/attempt pair.
- PK/unique indexes cover catalogue reference lookups, provider identity lookup,
  session-token lookup, account/verse learning lookup, operation deduplication,
  and one completion per account/day.
- Additional indexes cover every FK's leading columns, owner/state learning
  queries, owner/item attempt history, owner/day attempts, owner/due review queries,
  and session expiry. The integration suite checks FK index coverage against
  PostgreSQL's actual catalog, not just Drizzle metadata.

## Ownership boundary

RLS is enabled and **forced** on every private table, including `users`.
Policies apply to SELECT, INSERT, UPDATE, and DELETE, with both `USING` and
`WITH CHECK`. Missing context sees no private rows and cannot insert them. Policies
also prevent transferring a row to another owner. The shared Bible catalogue is
not user-owned; no public reader API/access decision is implemented by this DDL.

Use `withUserDatabase(database, authenticationContext, callback)` for private
database work. `AuthenticationContext` is an application-facing interface to be
implemented by trusted server-side authentication. The adapter resolves and
validates that identity, opens a transaction, and uses parameterized
`set_config('mathaino.user_id', ..., true)` to bind it locally. Success restores
the previous scope; rollback restores context on failures. Never supply this
context from an owner ID in a request body, query string, or URL.

RLS is not authentication: the server's database credential can set its context.
Do not expose that credential or arbitrary SQL to clients. Production runtime
roles should be non-owner, non-superuser and `NOBYPASSRLS`, separate from the
migration role. Local tests use a non-superuser owner and verify that FORCE RLS
prevents owner bypass. Superusers and BYPASSRLS roles are not suitable for runtime
ownership checks.

Pre-authentication identity/session lookup and provisioning use the dedicated
`mathaino_auth` role, not anonymous access through the owner-scoped application
path. It has access only to auth records; learning tables remain unavailable to
it. See [authentication.md](authentication.md) for roles, policies, routes, and
the approved native-session storage adjustment.

## Migrations

```sh
npm run db:generate -- --name=describe_the_change
npm run db:check
npm run db:migrate
```

Commands read validated `DATABASE_URL` using Next.js environment loading.
Generation/checking do not connect to the database. Review generated SQL before
applying it. `db:migrate` uses the committed journal through Drizzle's transactional
migrator; already applied entries are not applied twice. It has no reset, schema
push, seed, or destructive cleanup step.

`0000` through `0003` create the identity, catalogue, learning, and practice graph.
`0004` contains Drizzle-declared ownership policies. `0005` is the explicit custom
migration for FORCE RLS and update triggers, which are not represented by Drizzle's
table snapshot. Keep those custom invariants when adding future private/mutable
tables. Migration scripts use native Node TypeScript and the `react-server`
condition for the `server-only` sentinel; no runtime TypeScript loader was added.
Operational artifacts must include `scripts/`, `src/`, and `drizzle/`.

`0006` adds chapters and ordering. It backfills chapter keys from existing verses
before adding the FK, preserving legacy text identifiers and unknown order without
coercion, and installs the chapter update trigger. Builds and application requests
never apply migrations automatically. Schema tests use isolated stores; the
subsequent user-approved KJV operator import applied additive migrations to local
development. No production store was used.
`0007` and `0008` add Better Auth-compatible records, retain legacy credentials,
and grant the dedicated non-bypass role only auth-table access. See the auth guide
for the administrator role prerequisite and secure runtime configuration.

## Seed infrastructure

`seedReferenceData(database, data)` accepts an explicit internal contract:

```text
{
  books: [{ translationId, id, name }],
  verses: [{ translationId, bookId, chapter, verse, text }]
}
```

This is **not a KJV JSON format**. The seed function
itself validates unknown input, required/extra fields, arrays, and nonempty strings.
It preserves exact identifiers and text, inserts inside one transaction, and is
idempotent for identical records. Conflicting existing names/text cause failure
and rollback; existing data is never overwritten. FK failures also roll back the
whole batch. Private user/auth/progress fixtures are not part of reference seeding.
It ensures chapter parents exist without changing this legacy seed contract.

```sh
npm run db:seed
```

No datasets are registered in that command yet. It validates configuration and
runs an explicit empty seed, returning `{"booksInserted":0,"versesInserted":0}`.
It does not read, parse, import, modify, or invent files under `bible/kjv/`.
The separate `bible:import` command implements the inspected source adapter,
transactional bulk import, canonical ordering, and detailed report described in
[kjv-source.md](kjv-source.md).

## Integration isolation and verification

```sh
docker compose --profile test up -d --build --wait postgres-test
TEST_DATABASE_URL=postgresql://mathaino_test:mathaino_test_local@127.0.0.1:54330/mathaino_test TEST_AUTH_DATABASE_URL=postgresql://mathaino_auth:mathaino_auth_test_local@127.0.0.1:54330/mathaino_test npm run test:integration
```

Schema helpers accept only the explicit loopback `_test` target without query
overrides. They apply real committed migrations, then wrap each fixture/test in a
transaction that is rolled back even after success. Expected SQL failures use
nested savepoints; they cannot poison following assertions. No TRUNCATE, table
drop, database reset, source-file write, or development/production fallback is
used. CLI tests receive the same validated isolated URL explicitly.

Observed RED -> GREEN groups: identity (6 tests), catalogue (7), learning (5),
practice/reviews/transactions (13), ownership/timestamps (31), trusted context (4),
seeding (11), and command infrastructure (4). One additional catalog-based test
checks all FK indexes; the original connectivity test also remains. Raw-SQL due
time coverage was corrected to compare the PostgreSQL instant/type, because the
raw driver returns timestamps as strings rather than JavaScript Date objects.

Initial schema-task verification passed: `npm run test` (24 tests), the explicit test-database
integration command above (83 tests), `npm run lint`, `npm run format:check`,
`npm run typecheck`, and `npm run test:e2e` (two Chromium tests, including its
production build/start). `npm run db:check` passed with the explicit isolated
`DATABASE_URL`; `npm run db:generate -- --name=schema_consistency` reported no
schema drift.

The native `db:migrate` and empty `db:seed` commands were also verified on a newly
created `mathaino_schema_verification_test` database in the test container. It had
nine application tables, seven forced-RLS private tables, six applied migrations,
and zero imported Bible verses. No development or production database was used.
`git diff --exit-code -- bible/kjv` confirmed source Bible preservation.
