# Mathaino Engineering Rules

Mathaino is a lightweight Bible memorisation application. Keep changes small,
understandable, testable, and production-minded.

## Scope and repository inspection

- Read this file and any applicable nested AGENTS.md before making changes.
- Inspect existing files, conventions, tooling, and relevant data first.
- Do not build features beyond the requested task.
- The initial repository contains local Bible data but no application scaffold
  or configured test, lint, or TypeScript tooling.
- Do not introduce a framework, database, authentication provider, or dependency
  without a concrete task requirement.

## Architecture

Maintain clear dependency boundaries:

- **Domain:** framework-independent TypeScript containing business rules, domain
  types, and invariants. No UI, filesystem, network, or database code.
- **Application:** use cases that coordinate domain logic through small,
  purpose-specific interfaces.
- **Infrastructure:** adapters for Bible files, persistence, authentication, and
  other external systems. Implement application-facing interfaces here.
- **UI:** presentation, interaction, and view state. Delegate business decisions
  to application use cases.
- **Composition:** wire concrete adapters to use cases at application entry points.

Dependencies point inward: UI and infrastructure may depend on application and
domain code; domain code must not depend on outer layers. Application code must
not depend on concrete infrastructure or UI implementations.

Introduce directories and interfaces only when needed. Prefer explicit functions
and data flow over generic frameworks and speculative abstractions.

## Mandatory test-driven development

Every new or changed behaviour follows **RED -> GREEN -> REFACTOR**.

1. **RED:** write a focused test expressing the required observable behaviour.
   Run it before implementation and confirm it fails for the intended reason.
   Missing dependencies, broken imports, or unrelated setup failures do not
   count as a valid RED result.
2. **GREEN:** implement the smallest correct change that passes the test.
3. **REFACTOR:** improve structure without changing behaviour, then rerun tests.

- Repeat this cycle for each behaviour; do not implement several behaviours and
  add tests afterward.
- For bug fixes, first reproduce the defect with a failing regression test.
- Never weaken, skip, delete, or alter tests merely to make an incorrect
  implementation pass.
- Change test expectations only when requirements or a demonstrably incorrect
  test justify it; explain why.
- Test observable outcomes rather than incidental implementation details.
- Cover relevant success, invalid-input, boundary, and failure cases.
- Include unauthenticated and cross-user denial tests for owned resources.
- Keep tests isolated and deterministic. Control time, randomness, and IDs where
  those affect behaviour.
- Use temporary fixtures or isolated test stores, never real user data.
- Documentation-only changes require review and available documentation checks;
  they do not require artificial application tests.

## TypeScript and implementation quality

- Enable TypeScript strict mode (`"strict": true`) when TypeScript tooling is
  introduced.
- Do not weaken strictness or use unjustified `any`, suppression comments, or
  unsafe assertions to bypass errors.
- Treat untrusted values as `unknown` until runtime validation succeeds.
- Prefer existing tooling and platform capabilities over new dependencies.
- Add dependencies only for a clear need and explain the tradeoff.
- Use clear names, small cohesive modules, and explicit error handling.
- Do not silently discard errors or claim success after a failed operation.
- Keep secrets and sensitive user data out of source code and logs.

## External inputs and ownership

- Validate external inputs at their entry boundaries, including requests,
  route/query parameters, imports, stored data, environment configuration, and
  Bible JSON.
- Validate shape, type, bounds, supported identifiers, and semantic constraints.
  TypeScript types alone are not runtime validation.
- Resolve Bible references against known local identifiers. Never concatenate
  arbitrary user input into filesystem paths.
- For authenticated storage, derive identity from the trusted authentication
  context, not a user-supplied owner ID.
- Enforce ownership at the trusted persistence boundary for every read, list,
  create, update, and delete involving user-owned data.
- Scope queries and mutations by owner. Never rely on UI filtering as access
  control.
- If database access policies are used, verify them with integration tests.

## Local Bible data

- Inspect `bible/kjv/` and the relevant files before designing any Bible adapter,
  parser, fixture, or type.
- Use local Bible data. Do not fetch translations from external APIs.
- Do not invent or assume a Bible JSON format.
- Observed layouts:
  - `en-kjv.json` contains translation metadata.
  - `books/<book>/chapters/<chapter>.json` contains a `data` array whose records
    include `book`, `chapter`, `verse`, and `text`.
  - `books/<book>/chapters/<chapter>/verses/<verse>.json` contains `verse` and
    `text`.
  - Observed chapter and verse values are strings.
- These observations are not proof that every file has been validated.
- Inspect available books, chapters, and verses. Do not assume uniform,
  contiguous numbering or a fixed 66-book collection. For example, the inspected
  `esther(greek)` directory has chapter files numbered 10 through 16.
- Preserve original text, punctuation, annotations, metadata, and filenames.
- Do not silently strip inline notes or paragraph markers. Any display or
  comparison normalisation requires explicit requirements and TDD.
- Put parsing and conversion in infrastructure adapters, exposing validated
  domain values through application-facing interfaces.
- Treat source Bible files as read-only. Keep generated artifacts separate.

## Data and command safety

- Do not delete or overwrite existing user data or unfamiliar user work.
- Do not run destructive commands without explicit permission.
- Ask before destructive migrations, resets, cleanup, or bulk replacement.
- Tests and scripts must not write to source Bible files or real user stores.
- Do not commit, push, or change repository history unless requested.

## Verification and completion

After each task:

1. Run relevant tests, including regressions and affected integration tests.
2. Run configured linting and TypeScript type checking.
3. Run the build when the change affects build or packaging behaviour.
4. Review the diff for scope, accidental data changes, and unnecessary additions.

Use actual repository commands. When tooling is introduced, document reproducible
commands for tests, linting, and type checking.

If a check is unavailable or blocked, report that fact and the reason. Never
describe an unrun check as passing.

Report:

- What changed and why.
- Behaviours covered and the observed RED -> GREEN results.
- Exact verification commands and their outcomes.
- Any unresolved failures or unavailable checks.

Keep changes small and reviewable. A task is complete only when its required
checks pass or any verification blocker is explicitly reported.

### Per-task verification checklist

- [ ] Inspect relevant existing code, instructions, and data before editing.
- [ ] Keep the change within the requested scope.
- [ ] Observe RED before implementing each new or changed behaviour.
- [ ] Reach GREEN, refactor as needed, and rerun relevant tests.
- [ ] Verify invalid inputs and ownership boundaries where applicable.
- [ ] Run configured linting and strict TypeScript checking.
- [ ] Run build checks when applicable.
- [ ] Review the change for accidental user-data or source Bible modifications.
- [ ] Report checks, outcomes, and unavailable tooling honestly.
