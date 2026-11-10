# Mathaino

A lightweight Bible memorisation application with a public, chapter-sized KJV
reader, persistent verse selection, PostgreSQL storage, and Better Auth account
creation/login/logout.

## Development

Use Node.js 24 LTS, version 24.15.0 or later, and npm. Node 22.22.2+ within
the 22.x line or Node 26+ also satisfies the configured toolchain. These minima
include jsdom's runtime requirements. Initial setup was verified on Node 26.3.1
and npm 11.16.0.

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>. `GET /api/health` returns application liveness, not
database readiness. The homepage, health endpoint, and build do not need a live
database.

For database work, create your own `.env.local` using `.env.example` as a reference
and start the local development PostgreSQL service:

```sh
docker compose up -d --build --wait postgres
```

Do not replace an existing environment file or point tests at this database.
Before signing in, configure the dedicated auth connection, application origin,
and your own generated secret as described in [authentication.md](docs/authentication.md).

## Checks

```sh
npm run test
npm run lint
npm run format:check
npm run typecheck
npm run build
npx playwright install chromium
```

`test:e2e` builds and starts its own production server on port 3100. For live
PostgreSQL integration and isolated browser checks:

```sh
docker compose --profile test up -d --build --wait postgres-test
TEST_DATABASE_URL=postgresql://mathaino_test:mathaino_test_local@127.0.0.1:54330/mathaino_test TEST_AUTH_DATABASE_URL=postgresql://mathaino_auth:mathaino_auth_test_local@127.0.0.1:54330/mathaino_test npm run test:integration
TEST_DATABASE_URL=postgresql://mathaino_test:mathaino_test_local@127.0.0.1:54330/mathaino_auth_e2e_test TEST_AUTH_DATABASE_URL=postgresql://mathaino_auth:mathaino_auth_test_local@127.0.0.1:54330/mathaino_auth_e2e_test npm run test:e2e
```

See [database schema and operations](docs/database.md),
[authentication setup and security boundaries](docs/authentication.md),
[KJV source observations and import results](docs/kjv-source.md),
[development and test isolation](docs/development.md),
[requirements](docs/requirements.md), [architecture](docs/architecture.md), and
[initial verification results](docs/setup-verification.md). Follow [AGENTS.md](AGENTS.md)
and RED -> GREEN -> REFACTOR for every new behaviour.

## Local Bible data

`bible/kjv/` is a read-only source. Do not reformat it, overwrite it, or fetch
replacement translations from an external API. The importer preserves original
text and explicitly reports duplicates and additional books. The approved
Protestant collection is now imported into local development PostgreSQL. Validate
the source without a database using:

```sh
npm run bible:import -- --validate-only --allow-identical-duplicates
```
