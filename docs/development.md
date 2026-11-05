# Development and test isolation

## Stack and boundaries

- Next.js App Router and React, with a synchronous server-rendered homepage.
- Strict TypeScript, including unchecked-index protection.
- Tailwind CSS through its PostCSS adapter. Explicit source scanning covers
  `src/` only, never the Bible corpus or generated output.
- Drizzle ORM with the `pg` PostgreSQL driver and Drizzle Kit configuration.
- Vitest with React Testing Library/jsdom, plus Playwright Chromium smoke checks.
- ESLint's Next.js/TypeScript rules and Prettier. ESLint 9 is pinned because the
  selected Next.js config's React/import/accessibility plugins declare support
  through ESLint 9; upgrading to 10 produced peer conflicts and was reverted.

Next.js route files are entry points. Database and configuration code live in
infrastructure; domain/application modules will be added when product behaviour
requires them. No application tables, authentication, reader, learning policy,
speech provider, or PWA/offline policy is implemented here.

Dependencies are pinned in `package.json` and `package-lock.json`. Use `npm ci`
for reproducible installs. `@next/env` lets Drizzle Kit use Next.js environment
loading without another dotenv dependency. Small runtime validation functions use
the platform URL parser instead of adding a schema library.

## Commands

| Command                    | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `npm run dev`              | Next.js development server on port 3000                       |
| `npm run build`            | Production compilation, prerendering, and Next.js type checks |
| `npm run start`            | Serve an existing production build                            |
| `npm run test`             | Deterministic unit and component tests, once                  |
| `npm run test:watch`       | The same tests in watch mode                                  |
| `npm run test:integration` | Explicit live PostgreSQL tests; requires `TEST_DATABASE_URL`  |
| `npm run test:e2e`         | Playwright; builds and starts a dedicated production server   |
| `npm run lint`             | ESLint; warnings fail the check                               |
| `npm run typecheck`        | Generate Next.js route types, then run strict `tsc --noEmit`  |
| `npm run format:check`     | Check application/configuration/tests and development docs    |
| `npm run format`           | Format those same scaffold files                              |

Formatting is scoped to the scaffold, README, and this guide. Existing planning
documents and source Bible files are not bulk-formatted. `.prettierignore` also
excludes the Bible corpus, lockfile, dependencies, and generated artifacts.

## Environment configuration

Use `.env.example` as a reference; it contains local-only example credentials.
Never overwrite an existing user environment file. `.gitignore` excludes actual
environment files while allowing `.env.example`.

| Variable            | Usage                                                         |
| ------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`      | Server-only PostgreSQL URL for application/Drizzle operations |
| `TEST_DATABASE_URL` | Explicit loopback test URL for live integration tests         |

`validateDatabaseUrl` rejects absent/non-string values, raw whitespace, unsupported
protocols, missing hosts/database names, invalid ports, and URL fragments. Errors
identify the variable without echoing its value or credentials.

Next.js validates `DATABASE_URL` during configuration loading if supplied. An
omitted URL allows the database-independent homepage, health endpoint, and build.
Database construction and Drizzle Kit require a valid URL; there is no implicit
production connection string. The factory validates its input before creating a
pool. No connections or SQL are executed simply by importing modules.

Only server code can import the database adapter (`server-only` boundary).
Credentials must never use a `NEXT_PUBLIC_` prefix or be passed to client props.

## PostgreSQL and Drizzle

Docker Compose defines two separate local stores using supported PostgreSQL 15:

| Service                        | Host port         | Database / role | Data lifetime            |
| ------------------------------ | ----------------- | --------------- | ------------------------ |
| `postgres`                     | `127.0.0.1:54329` | `mathaino`      | Named development volume |
| `postgres-test` (test profile) | `127.0.0.1:54330` | `mathaino_test` | Ephemeral tmpfs          |

The initial setup used the available PostgreSQL 15 image after a PostgreSQL 17
download stalled. This is a local development choice, not a production hosting
commitment. Upgrade the base image deliberately with compatibility verification.

Bootstrap SQL creates non-superuser database-owner roles, not application tables.
Bootstrap admin credentials and application passwords are local examples only.
Build contexts contain only `docker/postgres/`; Bible data is not sent to Docker.
SQL is copied into the image to avoid host Documents-folder bind-mount permission
failures. Development initialization runs only for a new development volume.
Do not reset an existing volume to re-run it without explicit permission.

`createDatabase` returns a Drizzle client and an explicit asynchronous `close`.
Construct one at the future composition boundary and reuse it, rather than
creating a pool per request. Pools have a maximum of five connections, a three-
second connect timeout, and a ten-second idle timeout. Close owned pools during
shutdown and test cleanup. No global authentication or persistence framework is
introduced.

`drizzle.config.ts` points at an intentionally empty application schema and the
separate `drizzle/` migration-output directory. Once a tested feature needs tables,
review its schema and generate reviewable migrations. This setup does not run
schema push, migrations, resets, or seeding against any user store.

## Test isolation and helpers

### Unit and component tests

`vitest.config.mts` has explicit Node unit and jsdom component projects. Both
restore mocks and stubbed environment values and isolate test files. Component
setup installs jest-dom assertions and cleans the rendered DOM after every test.
These suites do not load `.env.local`, make database connections, or discover
integration/Playwright tests. Aliases match TypeScript's `@/*` mapping.

### Database integration

```sh
docker compose --profile test up -d --build --wait postgres-test
TEST_DATABASE_URL=postgresql://mathaino_test:mathaino_test_local@127.0.0.1:54330/mathaino_test npm run test:integration
```

`vitest.integration.config.mts` discovers only integration tests and serializes
files. Its helper requires an explicit test URL: loopback host, database suffix
`_test`, and no query overrides. It never loads or falls back to `DATABASE_URL`.
The foundation test verifies the expected database and role, executes a read-only
query through Drizzle, confirms the role is not a superuser, and closes its pool
in `finally`. It does not mutate source files, application data, or schema.

The integration suite mocks only Next.js's `server-only` import sentinel because
it runs in plain Node; real client/server import protection is enforced by Next.
It does not mock PostgreSQL or Drizzle. Future mutation tests must use isolated
fixtures/transactions in the test store, never development/production data.

### Browser tests

Install Chromium once with `npx playwright install chromium`.
`playwright.config.ts` runs `npm run build` and `npm run start` on loopback port
3100, refusing to reuse an unrelated server. Its environment supplies a valid
but intentionally unreachable database URL, demonstrating that foundation flows
do not depend on a real database. The explicit test URL is cleared for that
server. A preexisting listener on port 3100 is an error, not an excuse to test it.

Vitest never discovers `tests/e2e/`. Browser checks exercise the accessible main
heading/title and the actual HTTP health response. Artifacts are retained on
failure and ignored by Git. Async server components, when introduced, need real
browser/integration coverage rather than pretending jsdom fully supports them.

## Health contract

`GET /api/health` returns status 200, JSON `{ "status": "ok" }`, and
`Cache-Control: no-store`. It is application liveness only, exposes no environment
or database details, and performs no external calls. Database readiness would be
a separately specified behaviour with its own RED -> GREEN cycle.

## Verification discipline

Follow [AGENTS.md](../AGENTS.md). Test the behaviour before implementing it and
observe a meaningful assertion failure, not a broken import or unavailable
dependency. Do not weaken tests to make incorrect code pass. Run affected tests,
lint, strict types, and applicable builds; report unavailable checks honestly.

The initial command/results record is [setup-verification.md](setup-verification.md).
