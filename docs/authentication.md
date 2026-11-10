# Authentication

Mathaino uses **Better Auth 1.7.18** and its matching maintained Drizzle adapter.
The user approved email/password authentication and Better Auth's native
database-session model. No application password hashing, token generation,
signing, encryption, or cryptographic comparison is implemented manually.

Better Auth's optional Drizzle Kit peer made its legacy esbuild loader part of the
production dependency audit. A narrowly scoped override pins only
`@esbuild-kit/core-utils`'s esbuild dependency to patched 0.25.12, the version line
already supported by Drizzle Kit. Sync/async TypeScript transform compatibility,
migration generation/checking, builds, and auth tests verify the override. The
production audit reports zero findings; eight pre-existing moderate development
tooling findings remain in the Next.js ESLint/TypeScript/minimatch chain. No forced
framework downgrade or incompatible lint dependency upgrade was applied.

## Implemented flows

- `/register`: accessible name/email/password form; account creation does not
  automatically sign in. Duplicate and new registration have the same public
  response. Continue to `/login?registered=1`.
- `/login`: sign in with email/password, then navigate to the fixed `/practice`
  path. Caller-provided `next` and callback destinations are never used.
- `/practice`: dynamic server-rendered protected page. A verified database-backed
  session is required; missing/expired sessions redirect to `/login`. The page
  displays only that account's existing learning items and supports sign-out.
- Sign-out revokes the database session, clears its cookie, then performs a full
  navigation to `/login` so private in-memory UI state is discarded.
- Protected read-only APIs: `GET /api/learning-items` and
  `GET /api/learning-items/[id]`. They return 401 without a session, 404 for another
  owner's item, and 400 for malformed IDs or owner/query parameters.

These reads expose existing learning facts; no daily-queue, mastery, streak, or
learning-mutation policy was added by the authentication task.

## Passwords and sessions

Better Auth's built-in scrypt implementation hashes and verifies passwords.
Passwords are 12–128 characters, are never trimmed, and are not stored or logged
in plaintext. Names are bounded to 100 characters and email to 254. Emails are
normalised to lowercase; new email identities are unique. Legacy users can retain
NULL email rather than being assigned fabricated identities.

Sessions persist for a fixed seven days; rolling refresh and cookie-session
caching are disabled. Every protected request resolves its signed cookie through
the library and checks the persisted session. The application context memoizes
only within one request, not across users/requests. Revocation and expiry are
authoritative immediately on the next server check.

Cookies are HttpOnly, SameSite=Lax, host-only, and Path=/. HTTPS origins use Secure
and the `__Host-` session-cookie prefix. HTTP is accepted only for explicit
loopback development/test origins, where Secure cannot be required for local
HTTP browser operation. Non-loopback HTTP configuration is rejected. Production
must be served over HTTPS.

The public auth boundary exposes only registration, login, logout, and sanitized
session information. Successful mutation responses are `{ "ok": true }`, and
session reads expose only the verified user and expiry. Library session tokens,
password hashes, and internal account records are not returned in public JSON.
Other built-in auth endpoints are not exposed by the route adapter.

### Approved session-storage adjustment

The earlier planned schema stored only session-token digests. The user explicitly
approved switching new sessions to Better Auth's native opaque-token storage to
avoid implementing a custom authentication adapter/protocol. The new nullable
`token` column is library-managed. Existing `token_hash` rows remain unchanged;
an XOR check requires exactly one representation. Legacy digest-only rows are not
interpreted as native Better Auth sessions. No data is erased or converted into
invented tokens. Existing UUID identities and learning relationships are retained.

## Server and database boundaries

`AuthenticationContext` remains an inward-facing application port. Its server
implementation derives the user UUID from Better Auth's verified session, never
from a request-supplied owner ID. Learning adapters use explicit owner predicates
and `withUserDatabase` transaction-local context; forced RLS remains in place for
all owned learning tables.

Better Auth has its own pool using the **`mathaino_auth`** PostgreSQL role. This
non-superuser/NOBYPASSRLS role has DML rights only on `users`, `auth_accounts`,
`auth_sessions`, `auth_verifications`, and `auth_rate_limits`. Role-specific
policies permit the pre-authentication identity/session work the maintained
library needs. The role has no Bible or learning-table privileges, even if it sets
a forged owner context. It is not granted to the application role.

The application pool continues to use its separate non-bypass role. Startup
checks actual PostgreSQL roles/database identity and fails closed on superuser,
BYPASSRLS, wrong auth role, or mismatched database configuration. URL query options
cannot override connection identity, target, or session context. No sessions are
kept in module-global request state; only reusable service/pool instances are.

`0007_better_auth_records.sql` adds library-compatible fields, verification and
rate-limit tables, and role-specific policies. `0008_authentication_role_boundary.sql`
grants only the necessary auth-table privileges and forces RLS on the two new
service-only tables. An administrator must provision `mathaino_auth` before these
migrations. Fresh local Docker bootstrap scripts already do so; they do not need
or perform a reset of existing volumes.

## HTTP validation and abuse protection

- Mutation origins must exactly match the configured application origin; absent,
  `null`, and foreign origins fail. Better Auth's own CSRF/origin checks remain on.
- Bodies must be JSON and are read with an actual 8 KiB streaming limit. Malformed
  JSON/UTF-8, wrong types, unknown fields, control-character names, invalid Unicode,
  and invalid bounds are rejected before persistence or password hashing.
- Owner IDs, verification flags, callback URLs, and redirect URLs are not accepted
  as auth payload fields. Learning route IDs are validated at their boundary.
- Auth responses use `Cache-Control: no-store`; learning APIs use
  `Cache-Control: private, no-store` and vary by cookie.
- The library's atomic PostgreSQL-backed rate limiter is enabled: ten sign-in or
  registration attempts per minute, with a sixty-request general per-path limit.
  Forwarded client-IP headers are deliberately not trusted by default, so limits
  use a conservative shared per-path bucket. Configure a verified reverse-proxy IP
  contract before changing that policy; arbitrary caller headers must not bypass
  throttling. No Redis or custom limiter was introduced.
- Invalid credentials and duplicate registration do not disclose account
  existence. Operational failures return an explicit unavailable response; logs
  use sanitized messages rather than credentials, tokens, or request bodies.

## Local configuration

Use `.env.example` as a reference and add the following to your own ignored
`.env.local` without replacing existing values:

```dotenv
DATABASE_URL=postgresql://mathaino:mathaino_local@127.0.0.1:54329/mathaino
AUTH_DATABASE_URL=postgresql://mathaino_auth:mathaino_auth_local@127.0.0.1:54329/mathaino
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<your-generated-secret>
```

Generate the secret locally with `openssl rand -base64 32`. No usable development
or production secret is committed or silently defaulted. Auth configuration is
validated when services are first used, so static builds and liveness do not need
database credentials or a real secret. Restart the server after configuration
changes.

For a fresh local volume:

```sh
docker compose up -d --build --wait postgres
DATABASE_URL=postgresql://mathaino:mathaino_local@127.0.0.1:54329/mathaino npm run db:migrate
npm run dev
```

For the existing development volume, the role was provisioned non-destructively
and additive migrations applied during this task. No user account was created in
development and the imported Bible catalogue was preserved. Fresh PostgreSQL
deployments must create the same non-bypass auth role with a deployment-specific
password before migration; local example passwords are not production values.

## Isolated tests

The PostgreSQL test bootstrap creates `mathaino_test` and a separate
`mathaino_auth_e2e_test` database, both owned by the non-superuser test application
role, plus the restricted auth role. On already-running test volumes these roles
and the extra E2E database were added without a reset.

```sh
npm run test
TEST_DATABASE_URL=postgresql://mathaino_test:mathaino_test_local@127.0.0.1:54330/mathaino_test TEST_AUTH_DATABASE_URL=postgresql://mathaino_auth:mathaino_auth_test_local@127.0.0.1:54330/mathaino_test npm run test:integration
TEST_DATABASE_URL=postgresql://mathaino_test:mathaino_test_local@127.0.0.1:54330/mathaino_auth_e2e_test TEST_AUTH_DATABASE_URL=postgresql://mathaino_auth:mathaino_auth_test_local@127.0.0.1:54330/mathaino_auth_e2e_test npm run test:e2e
```

Integration fixtures primarily run in rollback-only auth transactions. The
cross-connection ownership tests commit only uniquely named synthetic accounts
and remove those exact accounts afterward; their learning fixtures roll back.
Only fixture abuse counters in the explicitly isolated, serialized test store are
reset. E2E preparation refuses any database other than the dedicated loopback
`mathaino_auth_e2e_test` store. It applies migrations and seeds synthetic references,
never the real KJV corpus. No test falls back to the development URI.

Tests cover registration, hashing, invalid credentials, duplicate registration,
persistent sessions, logout/replay, tampering, expiry, role privileges, server-side
ownership, malformed requests, origin checks, redirects, throttling, and labeled
form feedback. Browser tests run against a production build, verify mobile reflow,
and exercise actual cookies and database state. The mobile login screenshot was
reviewed; borders were darkened for control contrast. The E2E error assertion is
scoped to its labeled form because Next.js also supplies its own alert live region.

Email verification/delivery, password-reset delivery, OAuth/social providers,
account linking/deletion screens, and multiple-device session management remain
deferred. No email address is marked verified merely by registering.

## Verification results

Observed RED -> GREEN cycles covered auth configuration, library-backed account
and session flows, HTTP validation/serialization, real-session ownership binding,
forms, protected browser routes, and session-read throttling. Missing imports or
dependencies were not counted as RED. Expectations were not weakened to pass
incorrect authentication; the Next.js live-region selector adjustment retained
the same expected form error.

- `npm run test`: **76 passed**.
- The explicit isolated integration command above: **118 passed**.
- The dedicated E2E command above: **4 Chromium tests passed**, including its
  production build/start and the existing foundation regressions.
- `npm run lint`, `npm run typecheck`, `npm run format:check`, and a standalone
  `npm run build` without auth credentials: passed.
- `npm run db:check` with the isolated `DATABASE_URL`: passed;
  `npm run db:generate -- --name=schema_consistency`: no drift.
- `npm audit --omit=dev`: zero production findings after the targeted compiler
  override; sync/async legacy-loader transform checks also passed.
- `git diff --check` and `git diff --exit-code -- bible/kjv`: passed.

The source-file inventory retained all 38,193 files and SHA-256
`ab996bf5e05a50ce6ca42c820482d48f51172e05c1da18b135b74e3b42da2f2a`.
The development catalogue still has 66 books / 1,189 chapters / 31,102 verses;
database fingerprints including IDs and timestamps matched the earlier importer
results for all three tables. No real user data was used by tests.
