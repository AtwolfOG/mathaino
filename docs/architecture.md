# Mathaino architecture

Status: architecture baseline. The foundation now uses Next.js App Router, strict
TypeScript, Tailwind CSS, Drizzle/PostgreSQL, Vitest/React Testing Library, and
Playwright. Product modules, application tables, authentication, and speech
integration remain unimplemented. See [development.md](development.md).

Read with [requirements.md](requirements.md) and [AGENTS.md](../AGENTS.md).
US-xx and D-xx identifiers refer to stories and unresolved decisions in the
requirements. This document does not resolve those product decisions.

## 1. Architectural shape

Use a **modular monolith**: one logical application backend with cohesive internal
modules and a responsive PWA frontend. A backend-hosted frontend or separate
static asset hosting can both preserve this structure; hosting remains undecided.
External authentication, persistence, or speech services, if selected, are
adapters, not separately developed Mathaino feature services.

```text
Browser / PWA
  Reader | Learning queue | Recitation | Progress/settings
                       |
              Trusted application entry points
                       |
     Bible | Identity/settings | Learning | Practice | Reviews
                       |
          Application use cases -> Domain policies
                       ^
                       |
   Adapters: local KJV, persistence, auth, clock, transcription
```

Dependencies point inward. UI and infrastructure may depend on application and
domain contracts; application code must not import concrete infrastructure or
UI. The domain contains no framework, browser, filesystem, network, or database
code. Composition at entry points supplies concrete adapters.

Introduce only the modules, directories, and interfaces needed by the behaviour
being implemented. Do not build a generic repository framework, plugin system,
event bus, microservices, or a separate queue/scheduler service.

## 2. Module responsibilities

These are logical boundaries, not a requirement for separate packages.

| Module | Owns | Main stories |
| --- | --- | --- |
| Bible | Validated catalogue, reference resolution, chapter and verse retrieval | US-01, US-03 |
| Identity and settings | Trusted account context, practice settings, effective timezone policy | US-02, US-07 |
| Learning and recitation | Learning records, assessment, successful-day runs, mastery transitions | US-03, US-05, US-06, US-07 |
| Practice | Daily learning queue and account-wide qualifying activity/streak projection | US-04, US-08 |
| Reviews | Review policy, next-due evaluation, review outcomes | US-09 |

The UI delegates decisions to use cases. For example, it displays queue results,
not its own calculation of which items qualify. Modules collaborate through
explicit application functions/contracts rather than reading each other's
private storage directly. Shared verse references and time values remain small
domain types, not a catch-all shared-utilities layer.

## 3. Conceptual domain model

These are concepts and relationships, **not a database schema**. Field types,
indexes, storage engine, and migration strategy will be designed when required.

| Concept | Identity and meaning | Relationships / invariants |
| --- | --- | --- |
| Translation | Known local translation ID and metadata | Contains books; `en-kjv` is the existing source |
| Book / chapter / verse | Validated source identifiers, display metadata and original verse text | Translation -> books -> chapters -> verses; availability comes from source, not numeric assumptions |
| Verse reference | Translation, book, chapter, and verse identity | Resolves to one known local verse; does not contain a user-controlled path |
| User account | Internal identity resolved from verified authentication | Owns private settings and learning records; authentication credentials stay outside domain learning logic |
| Practice settings | Effective mastery threshold and approved day-attribution configuration | Belongs to one user; threshold scope/change semantics are D-07 |
| Learning record | One user's progress for one verse | Unique account/reference pair; learning or mastered; retains sufficient successful-day and mastery context |
| Recitation attempt | One logical submitted practice operation and assessed outcome | Belongs to a learning record; typing/voice mode, accepted time context, approved policy context and outcome; no raw audio required |
| Daily activity | Evidence that approved activity qualified on a calendar date | Belongs to one user; supports streak derivation without counting repeated activity twice |
| Review schedule | Effective scheduling state for a mastered item | Belongs to a learning record; next due and necessary policy state determined by D-10 |
| Review outcome | Accepted review result and its scheduling effect | Belongs to the same owner's learning record; can reference the recitation attempt rather than duplicate it |

```text
Translation -> Book -> Chapter -> Verse
                                  ^
                                  |
User -> Learning record ---------+
  |          |        |
  |          |        +-> Recitation attempts
  |          +-> Review schedule / review outcomes (when mastered)
  +-> Practice settings
  +-> Daily qualifying activity -> derived streak

Learning records + effective day policy -> derived daily learning queue
Review schedules + effective due policy -> derived due review list
```

No second mutable copy of Bible text is needed in each learning record. Daily
queues, streak counts, and review due status are projections, not independent
authorities. Persist derived values only if an actual need justifies the added
consistency burden. Long-term transcript/attempt history retention is D-02/D-06;
store only the facts needed for correctness and the approved product experience.

## 4. Application flows and state coordination

### Reader and adding a verse

1. Validate the requested reference against the known Bible catalogue.
2. Load through the local adapter and validate the source shape and reference.
3. Return original text and safe display metadata, or a typed failure.
4. For adding to learning, authenticate, resolve the owner's account, then create
   a learning record only if the account/reference pair is not already present.

Reading is public only if D-01 approves it. Private mutation always requires
authentication. Unknown references are not guessed or mapped to arbitrary paths.

### Recitation and progress update

1. Authenticate and validate operation identity, target, input, and configured
   bounds. Resolve the learning item under the trusted owner.
2. Obtain final text: directly from validated typing input or through the speech
   adapter. External calls happen outside persistence transactions.
3. Load authoritative verse text and effective assessment/time/mastery policies.
4. Assess through a pure domain function; do not accept client-supplied success,
   counters, mastery state, due dates, or day credit.
5. Apply the attempt, per-verse day effect, mastery transition, qualifying practice
   activity, and any review scheduling change as one consistent commit.
6. Return committed state for rendering. Repeated submission of the same logical
   operation returns the existing result without awarding progress again.

The trusted persistence boundary must serialize or detect conflicting updates to
the same learning state, including simultaneous tabs/devices. Scope operation
identity to the authenticated account and reject reuse with different content.
PostgreSQL is selected; feature-specific transaction and concurrency mechanisms
will be designed with the first tested persistence use case.

If a transaction rolls back, no partial credits or schedule changes survive. If
the response is lost after commit, the client cannot infer rollback: reconcile by
the same operation identity or reloading authoritative state. Do not advertise an
unknown outcome as either saved success or an assessed failure.

### Learning and review transitions

Use the transition table in requirements section 4 as the source of truth.
Keep assessment, day aggregation, mastery transition, and review policy explicit
so they can be tested independently and coordinated by a small use case.

- A successful assessment is not automatically another successful day.
- An item becomes mastered only after its effective consecutive-day threshold.
- Review due is a derived condition, not another mastery state.
- Technical speech or validation failures do not enter the failure/reset policy.
- D-07/D-08/D-10 must settle setting changes, mixed day outcomes, and review
  failure/demotion before those branches are implemented.

## 5. Day attribution, streaks, and scheduling

Put calendar/day and review computations in domain functions receiving explicit
time inputs. The application obtains the current instant through an injected
clock; adapters handle serialization and external timezone configuration.

The proposed IANA-zone/server-clock approach in requirements section 5 is pending
D-12. If adopted, retain the accepted instant, attributed local date, and zone
context needed to interpret activity consistently. Never compare date labels
lexicographically across unvalidated formats or treat a day as 86,400 seconds.

Per-verse successful-day runs and account-wide streaks consume different facts:
one concerns successful recall of a particular verse; the other concerns whatever
activity D-09 qualifies. Do not derive one counter from the other. Midnight/DST,
current-day display, travel, and offline submissions require explicit examples.

For reviews, evaluate due eligibility at read time using the approved policy.
No background job is necessary merely to discover a due item. The application
atomically applies each accepted review's schedule effect. D-10 must choose
intervals/algorithm, due dates versus instants, late/early anchors, repeated
same-day reviews, failed recall, and future policy changes. Do not install a
spaced-repetition dependency or scheduler before that choice is justified.

## 6. Local KJV infrastructure

The adapter exposes validated catalogue/reader values to application use cases,
not raw filesystem paths or unchecked JSON. Use the inspected layouts described
in [requirements.md](requirements.md); chapter documents and individual verse
documents are different shapes. Validate source identifiers as strings before
any deliberate conversion. Check semantic agreement between requested references
and returned records, including duplicate/mismatched records.

Determine a source-of-truth strategy for duplicated chapter/verse content during
adapter implementation: inspect and test consistency rather than silently prefer
one when the two conflict. Missing/corrupt data produces an explicit failure.
Book order and display rules are D-01. A complete source inventory/validation is
needed before claiming full-reader coverage; representative samples are not proof.

Known source identifiers form a lookup into safe local resources. Never construct
a filesystem path from unchecked request fragments. If deployment needs a
generated catalogue or packaged data, generate it separately from `bible/kjv/`;
do not rewrite source files. Serve chapter-sized resources or another measured
small payload strategy rather than eagerly loading the full corpus into the UI.

Preserve inline annotations and paragraph markers. Any derived comparison text
must have an approved D-05 policy and separate tests; source text is immutable.

## 7. Transcription architecture and failure handling

Two viable adapter placements remain open under D-06:

- Browser speech recognition: capability/permission constraints and possible
  vendor network processing must be understood; a browser API does not guarantee
  on-device processing or consistent cross-browser support.
- Browser capture with server-mediated transcription: backend holds provider
  credentials and validates/limits uploads; adds network, operational, privacy,
  and cost considerations. Do not select or install a provider yet.

Both return final text into the same server-side assessment use case as typing.
The client cannot make assessment authoritative by claiming a transcript or
confidence score proves success. Verifying that a learner genuinely memorised
text is outside the ownership/security boundary; private progress is not an
anti-cheat credential.

Conceptual capture/transcription states are idle, requesting permission,
capturing, transcribing, ready, cancelled, and error. These are interaction states,
not learning states. Interim results may be displayed but never credited.

| Failure | Required behaviour |
| --- | --- |
| Unsupported API, permission denied, or no device | Explain limitation and retain the typing path |
| Silence/no usable transcript | No assessment credit or penalty; allow explicit retry |
| Provider timeout/network/malformed response | Return recoverable transcription error; do not assess incomplete text |
| User cancels or leaves capture | Stop capture, release microphone, abort where possible, ignore stale late results |
| Authentication expires during transcription | Do not commit against stale auth; re-authenticate and reconcile before resubmission |
| Assessment persistence fails or response is lost | Report unsaved/unknown outcome accurately; reconcile idempotently |

Validate audio payloads and provider responses as unknown inputs. Bounds,
timeouts, rate/cost controls, consent, retention, and transcript correction need
D-06/D-13 decisions. Do not retain raw recordings by default or silently switch
providers. Retry must not trigger an unrequested new capture/upload. Record only
sanitized operational errors; not raw audio or full transcripts.

## 8. Security and ownership boundaries

- **Untrusted browser:** references, settings, text/audio, timestamps, operation
  identities, service-worker messages, and cached private data need validation.
- **Authentication boundary:** verify sessions/tokens server-side and resolve
  trusted internal identity. Provider choice is D-02; credentials and privileged
  service keys never enter the browser bundle.
- **Application boundary:** enforce valid operations and reject unknown or
  out-of-bounds input. Return safe errors without credentials or private payloads.
- **Persistence boundary:** every private query/mutation is owner-scoped,
  including nested lookups and lists. If database access policies are used,
  test them directly rather than relying only on application checks.
- **External speech boundary:** constrain outgoing data and validate responses;
  speech-provider failure cannot mutate learning as if it were an assessment.
- **Local Bible boundary:** validated known-identifier lookup; source files remain
  read-only. Render verse text as text, not executable markup.

Use HTTPS in deployment. Select session transport with its corresponding CSRF,
cookie/token handling, and expiry controls when choosing authentication. No
particular mechanism is assumed. Cross-user denial must cover account settings,
learning items, attempts, daily activity, schedules, and review outcomes.

## 9. PWA and UI boundary

Keep navigation and screens focused on reader, today's practice, recitation,
progress, and settings; this is a functional map, not a prescribed page count.
Use semantic HTML, keyboard support, visible focus, responsive reflow, and
accessible status announcements. Voice must not be the only route to completion.

Next.js App Router and Tailwind CSS provide the UI foundation; PWA tooling remains
undecided. Installation
requires appropriate manifest/assets and deployment support; service-worker
scope, updates, and caching depend on D-11. Installation does not guarantee
offline transcription or progress synchronization.

Separate versioned public Bible/app-shell caches from private account data.
Do not indiscriminately cache authenticated responses in a shared cache. On
sign-out or account change, clear private in-memory/persistent UI state and
prevent stale responses from repopulating it. Session secrets must not be placed
in general-purpose PWA caches. Offline mutation queues, merge policies, and
background sync are deferred until explicitly required.

## 10. Testing strategy

Mandatory workflow: write one focused behavioural test, observe its intended RED,
implement the smallest GREEN, then refactor and rerun. Broken setup/imports do
not count as RED. Never weaken a correct test to accommodate wrong behaviour.
Resolve affected D-xx policies before writing their expectations.

### Unit tests: domain rules

- Validated references and settings, positive integral thresholds, and bounds.
- Approved matching policy for both input modes, including source annotations.
- Consecutive-day logic, same-day attempts, gaps, threshold boundaries, and
  approved setting-change/failure rules.
- Streak qualification distinct from per-verse mastery; midnight, DST, and
  approved zone changes with fixed instants and zones.
- Review due/overdue boundaries and approved success/failure/anchor policies.
- Queue eligibility under the approved policy, with deterministic ordering.

### Integration tests: application and adapters

- KJV shape/semantic validation, known identifiers, numbered/nonstandard books,
  unavailable references, malformed data, and path traversal rejection. Use
  isolated fixture copies for corruption cases; never modify source Bible files.
- Catalogue/corpus validation against actual source as a read-only check before
  full-reader release; inspect chapter/verse duplicate consistency.
- Persistence across fresh authenticated sessions, atomic rollback, duplicate
  requests, conflicting operation identities, and simultaneous progress updates.
- Unauthenticated and cross-user denial for every owned read/list/mutation;
  direct policy tests if database access policies are selected.
- Transcription contract with deterministic stub responses, malformed responses,
  timeouts, cancellation, expired auth, and unknown commit outcomes. Optional live
  provider smoke checks are separate from deterministic required checks.

### Component tests: presentation and interaction

- Reader navigation, queue/loading/empty/error states, typing submissions, and
  accurate saved/unsaved feedback.
- Voice permission/capture states and typing fallback using controlled browser
  capability and microphone stubs; cancellation ignores late results.
- Accessible labels, focus management, keyboard flows, announcements, and
  narrow-screen reflow; combine automated checks with manual assistive-tech review.
- Account change/sign-out clears private state and discards stale responses.

### E2E tests: critical user journeys

- Read an available verse, authenticate, add it, practise, reload, and verify
  persisted progress in a new session.
- Advance controlled practice dates through mastery, then due review and the
  approved review outcome; never wait real days or rely on production clocks.
- Verify owner isolation with two isolated accounts and expired-session handling.
- Exercise voice through deterministic microphone/transcription substitutes;
  manually verify actual speech and permission UX on agreed target browsers.
- Verify installation support/fallback, responsive navigation, cache updates,
  sign-out isolation, and the offline guarantees selected by D-11.

Use temporary test stores and fixtures, not production users or real recordings.
Control clocks, zones, IDs, randomness, authentication, and external responses.
Keep the suite proportional; avoid asserting incidental component structure.

## 11. Implementation sequence and open choices

Suggested vertical slices, each preceded by the relevant decision and failing
tests: validated local reader; auth and persistence; add-to-learning and queue;
typed assessment/day progress; mastery/streaks; review scheduling; voice; agreed
PWA/offline capabilities. Accessibility and responsive behaviour apply throughout,
not only at the end. This is a dependency guide, not a delivery commitment.

The product decision register D-01 through D-13 is in requirements. Technical
choices still open are feature-specific transaction/concurrency mechanisms, auth
provider/session mechanism, transcription placement/provider, hosting, timezone
implementation, and PWA tooling. The selected foundation stack and commands are
documented in [development.md](development.md). Prefer platform capabilities and
few dependencies; justify each selection against an actual requirement.
TypeScript strict mode is enabled.

No microservices, separate scheduler, generic workflow engine, speculative
schema, or provider-specific abstractions beyond small needed ports. Deferred
features are listed in requirements section 9.

## 12. Verification checklist

- [ ] Required behaviour traces to a US-xx story and approved D-xx policy.
- [ ] Domain and application dependencies point inward.
- [ ] Behaviour has observed RED -> GREEN -> REFACTOR evidence.
- [ ] Unit/integration/component/E2E checks appropriate to the change pass.
- [ ] Ownership, invalid input, concurrency, time boundaries, and failures are covered.
- [ ] Configured lint and strict TypeScript checks pass; build runs when applicable.
- [ ] Source Bible files and real user stores remain unchanged.
- [ ] Diff stays within scope; commands, outcomes, and blockers are reported.

Reproducible test, lint, type-check, and build commands are documented in
[development.md](development.md).
Documentation-only changes need content/link review and available documentation
checks, not artificial application tests.
