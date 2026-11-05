# Initial setup verification

This record covers the foundation task on 2026-11-05. See
[development.md](development.md) for reproducible commands and
[AGENTS.md](../AGENTS.md) for the engineering rules. No application feature or
application-table migration was introduced.

## Environment

Node 26.3.1, npm 11.16.0, Next.js 16.4.5, TypeScript 5.9.3, Vitest 5.1.0,
Playwright 1.65.0, Docker Engine 23.0.5, and Docker Compose 2.17.3. The live
PostgreSQL test used the locally available PostgreSQL 15 image.

## Observed RED -> GREEN

| Exact command                                                                                                             | Observed RED                                                                                     | Observed GREEN                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `npm run test -- tests/component/foundation.test.tsx`                                                                     | Accessible main landmark absent from the empty page                                              | 1 test passed after the minimal page was implemented                                       |
| `npm run test -- tests/unit/environment.test.ts`                                                                          | All 14 invalid-input cases failed because the placeholder did not reject them                    | Validation passed those cases; valid-URL coverage brought the suite to 16 passing tests    |
| `npm run test -- tests/unit/health.test.ts`                                                                               | Placeholder response was 501, expected 200                                                       | 1 test passed with the JSON/no-store liveness contract                                     |
| `npm run test -- tests/unit/test-database-url.test.ts`                                                                    | 5 cases failed because the helper allowed non-isolated targets or lacked the test-specific error | Those cases passed; valid-target coverage brought the suite to 6 passing tests             |
| `TEST_DATABASE_URL=postgresql://mathaino_test:mathaino_test_local@127.0.0.1:54330/mathaino_test npm run test:integration` | Existing adapter stub explicitly reported that it was not implemented                            | 1 real PostgreSQL/Drizzle integration test passed after wiring and infrastructure recovery |

All RED runs reached the intended behaviour with imports and test tooling working.
Subsequent Docker unavailability/connection-refused failures were infrastructure
blockers, not counted as RED. No test expectations were weakened to pass incorrect
code. Configuration was then refactored and formatted, with the relevant checks
rerun.

## Successful verification commands

| Exact command                                                                                                             | Result                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run test`                                                                                                            | Passed: 24 tests across four unit/component files                                                                      |
| `npm run lint`                                                                                                            | Passed, zero warnings                                                                                                  |
| `npm run format`                                                                                                          | Formatted scaffold files and development documentation                                                                 |
| `npm run format:check`                                                                                                    | Passed                                                                                                                 |
| `npm run typecheck`                                                                                                       | Passed: route type generation and strict TypeScript                                                                    |
| `npm run build`                                                                                                           | Passed: optimized production build with `/` and `/api/health`                                                          |
| `npx playwright install chromium`                                                                                         | Installed Chromium, headless shell, and FFmpeg                                                                         |
| `npm run test:e2e`                                                                                                        | Passed: two Chromium tests against a newly built production server; Playwright ran its configured build/start commands |
| `docker compose --profile test config`                                                                                    | Parsed the isolated Compose configuration successfully                                                                 |
| `docker compose --profile test up -d --build --wait postgres-test`                                                        | Built the local test image; the isolated PostgreSQL container became healthy                                           |
| `TEST_DATABASE_URL=postgresql://mathaino_test:mathaino_test_local@127.0.0.1:54330/mathaino_test npm run test:integration` | Passed: read-only Drizzle query, expected database/role, non-superuser, and pool cleanup                               |
| `npm ls --depth=0`                                                                                                        | All requested direct dependencies installed, with no missing/invalid direct dependencies                               |
| `npm audit --omit=dev`                                                                                                    | Passed: zero production dependency vulnerabilities reported                                                            |

Some checks were executed together as
`npm run test && npm run lint && npm run format:check` and
`npm audit --omit=dev && npm ls --depth=0`; every command in those chains ran.
`npm run typecheck` was also rerun after the production browser checks.

`test:watch` is configured but an interactive watch session was not left running.
`npm ci` is documented for clean reproducible installation; it was not executed
during initial setup because the task used incremental installs and preserved
existing/generated files.

Final engine review aligned the project's minimum Node versions with jsdom's
stricter requirement: `^22.22.2 || ^24.15.0 || >=26.0.0`. The metadata-only command
`npm install --package-lock-only --offline` synchronized this in the lockfile.

## Installation retries and recovered blockers

The first combined install command was interrupted before completion:

```sh
npm install --save-exact next@16.4.5 react react-dom drizzle-orm@0.45.4 pg server-only && npm install --save-dev --save-exact typescript @types/node @types/react @types/react-dom @types/pg tailwindcss @tailwindcss/postcss eslint eslint-config-next@16.4.5 eslint-config-prettier prettier vitest@5.1.0 @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom @playwright/test drizzle-kit@0.31.11 @next/env@16.4.5
```

The development-dependency half of that interrupted chain did not complete.
Manifest/dependency inspection confirmed the incomplete state before retrying.

| Exact retry command                                                                                                                               | Result                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install --save-exact next@16.4.5 react react-dom drizzle-orm@0.45.4 pg server-only`                                                          | Timed out during dependency resolution                                                                                                                                 |
| `npm install --save-exact next@16.4.5 react react-dom drizzle-orm@0.45.4 pg server-only --prefer-offline --fetch-timeout=30000 --fetch-retries=1` | Failed with stale metadata for `@next/env@16.4.5`                                                                                                                      |
| `npm install --save-exact next@16.4.5 react react-dom drizzle-orm@0.45.4 pg server-only --prefer-online --fetch-timeout=30000 --fetch-retries=1`  | Incomplete; subsequent inspection found a partially installed Next.js package and dependency-resolution failure                                                        |
| `npm install --package-lock-only --prefer-online --fetch-timeout=30000 --fetch-retries=1`                                                         | Timed out; logs showed DNS failures for transitive dependency metadata                                                                                                 |
| `npm install --prefer-offline --fetch-timeout=10000 --fetch-retries=0`                                                                            | Failed with stale Babel generator metadata                                                                                                                             |
| `npm install --prefer-online --fetch-timeout=10000 --fetch-retries=0`                                                                             | Succeeded after explicit manifest setup; later rerun successfully to synchronize pins and repair an incomplete generated SWC dependency                                |
| `npm install --save-dev --save-exact eslint@10.14.0 --prefer-online --fetch-timeout=10000 --fetch-retries=0`                                      | Installed, but exposed incompatible declared peer ranges in the selected Next.js plugins; reverted to compatible ESLint 9 in the manifest and reran the normal install |

The first type-check attempt found a truncated native SWC binary left by the
interrupted installation. The incomplete generated package was moved to temporary
storage rather than deleted, then npm restored it. Native Next.js configuration
loading also required an explicit `.ts` import; TypeScript permits that with
`allowImportingTsExtensions` and `noEmit`. Later strict checks and builds passed.
An initial lint warning about an anonymous PostCSS default export was resolved
with a named configuration constant.

Docker troubleshooting used these commands:

```sh
docker info --format '{{.ServerVersion}}'
open -a Docker
docker compose --profile test up -d --wait postgres-test
docker image ls --format '{{.Repository}}:{{.Tag}}'
docker compose version
docker ps --format '{{.Names}} {{.Status}}'
docker context ls
docker compose --profile test logs postgres-test
```

The initial Docker daemon was stopped, then became unresponsive. With explicit
user permission, Docker Desktop was restarted; a graceful quit attempt timed out,
so its processes were terminated with TERM and Desktop was reopened. No factory
reset, volume deletion, source cleanup, or data migration was performed.

After recovery, a test-container startup exposed a bind-mount permission error
reading SQL from the host Documents folder. Copying bootstrap SQL into small local
images resolved it. The final `up -d --build --wait` and integration test passed.
The development database was not used by tests. The named development volume may
have been created by Compose, but was not initialized, reset, or populated by the
integration suite. The dedicated test service was left available locally.

## Remaining dependency findings

`npm audit --json` reported 12 moderate findings in the final compatible
development-tooling dependency tree (including Drizzle Kit's legacy esbuild
loader and Next.js ESLint tooling's minimatch chain). No high/critical findings
were reported. Production-only audit reported zero. These dev-tooling findings
remain unresolved; no force-fix, incompatible override, or framework downgrade
was applied. ESLint 9 also emits an upstream deprecation notice, but the selected
Next.js plugins' declared peer ranges do not yet accept ESLint 10.

## Bible preservation and scope review

The following read-only command ran before and after setup:

```sh
python3 -c 'import hashlib,pathlib; root=pathlib.Path("bible/kjv"); files=sorted(p for p in root.rglob("*") if p.is_file()); digest=hashlib.sha256(); [(digest.update(p.relative_to(root).as_posix().encode()+b"\0"),digest.update(hashlib.sha256(p.read_bytes()).digest())) for p in files]; print(f"Bible inventory: {len(files)} files; SHA-256 {digest.hexdigest()}")'
```

Both runs returned **38,193 files** and the same path/content digest:

```text
ab996bf5e05a50ce6ca42c820482d48f51172e05c1da18b135b74e3b42da2f2a
```

Source KJV paths and file contents are unchanged. Scope review used the applied
patches and direct file inspection because the directory is not a Git repository.
Existing architecture/requirements documents received only foundation-status and
tooling-link updates. No user environment file was created or overwritten, and no
product decision from D-01 through D-13 was silently resolved.
