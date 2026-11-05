# Mathaino

A lightweight Bible memorisation application. This repository currently contains
the application foundation and existing local KJV data; learning features are not
implemented yet.

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

## Checks

```sh
npm run test
npm run lint
npm run format:check
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

`test:e2e` builds and starts its own production server on port 3100. For live
PostgreSQL integration checks:

```sh
docker compose --profile test up -d --build --wait postgres-test
TEST_DATABASE_URL=postgresql://mathaino_test:mathaino_test_local@127.0.0.1:54330/mathaino_test npm run test:integration
```

See [development and test isolation](docs/development.md),
[requirements](docs/requirements.md), [architecture](docs/architecture.md), and
[initial verification results](docs/setup-verification.md). Follow [AGENTS.md](AGENTS.md)
and RED -> GREEN -> REFACTOR for every new behaviour.

## Local Bible data

`bible/kjv/` is a read-only source. Do not reformat it, overwrite it, or fetch
replacement translations from an external API. No reader/parser is implemented
by this foundation task.
