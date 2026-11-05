# Mathaino requirements

Status: planning baseline; no application features are implemented.

Read with [architecture.md](architecture.md) and [AGENTS.md](../AGENTS.md).
This document is the source of product requirements; architecture describes how
to support them without selecting vendors or silently resolving product policy.

## 1. Scope and terminology

Mathaino is a lightweight Bible memorisation application with a full local KJV
reader, authenticated persistent learning, daily learning queues, typing and
voice recitation, configurable mastery, practice streaks, and spaced reviews.
The experience must be responsive, accessible, and installable as a PWA where
the browser supports installation. Keep the UI and infrastructure minimal.

- **Required:** requested behaviour or an invariant necessary to make it correct.
- **Proposed:** a design recommendation awaiting approval, not a product promise.
- **Open (D-xx):** a decision that must be resolved before implementing the
  affected behaviour. Acceptance criteria referencing it are incomplete until
  the policy has been approved and expressed as test examples.
- **Assessment:** a domain decision that a completed recitation succeeds or
  fails under an approved matching policy. A technical error is neither outcome.
- **Successful day:** one calendar day qualifying for a particular verse's
  consecutive-day progress. This differs from an application-wide practice day.
- **Mastered:** the verse has met the configured consecutive-day requirement;
  it remains subject to spaced review, not a guarantee of permanent recall.

## 2. Existing Bible source

Before foundation setup, repository inspection found `AGENTS.md`, `bible/kjv/`,
and `.DS_Store` files, with no application scaffold or configured tooling. The
selected foundation stack and commands are now in [development.md](development.md).

Observed source files:

| File | Observed contents |
| --- | --- |
| `bible/kjv/en-kjv.json` | Translation metadata, ID `en-kjv`, scope `Bible with Deuterocanon` |
| `bible/kjv/books/genesis/chapters/1.json` | A `data` array of records with `book`, `chapter`, `verse`, and `text` |
| `bible/kjv/books/genesis/chapters/1/verses/4.json` | `verse` and `text`; includes an inline annotation |
| `bible/kjv/books/john/chapters/3/verses/16.json` | `verse` and `text`; includes a paragraph marker |
| `bible/kjv/books/esther(greek)/chapters/` | Chapter files numbered 10 through 16 |

Observed chapter and verse identifiers are strings. Available books include
deuterocanonical works. These samples do not validate the whole dataset.
Use the existing source, never external translation APIs. Preserve original
text, annotations, metadata, and filenames. Do not assume 66 books or contiguous
chapter/verse numbering. A full reader must expose the available dataset, not
silently omit unfamiliar books. Reading order and presentation remain D-01.

## 3. User stories and acceptance criteria

### US-01: Read the full Bible

As a reader, I can find and read every available book, chapter, and verse.

- Navigation uses validated local identifiers and actual available references.
- Selecting an available chapter displays its verses and references without
  silently stripping source content or inventing missing verses.
- Unavailable references, invalid input, and missing or malformed source data
  produce clear errors rather than fabricated text or traversal to arbitrary files.
- Reader navigation remains usable by keyboard and at narrow viewport widths.
- Public reading versus sign-in requirements, reading order, and search are D-01.

### US-02: Authenticate and retain learning progress

As a learner, I can authenticate, sign out, and recover my persisted progress
when I sign in again.

- A later authenticated session loads that account's committed learning state,
  settings, and review progress rather than resetting them.
- Private operations reject missing/expired credentials and cross-user access.
- Sign-out clears access to private UI and account-specific cached state.
- Failed saves are reported; the UI never labels an uncommitted change as saved.
- Authentication methods, recovery, session lifetime, and account lifecycle are D-02.

### US-03: Start learning a verse

As a learner, I can select an existing verse for learning and track its progress.

- Only a validated local verse reference can become a learning item.
- The item belongs to the authenticated account, not an owner supplied by the UI.
- Repeating the same add operation cannot accidentally create duplicate active
  progress for that account and verse or reset existing progress.
- Passage learning, removal, pausing, and intentional restarting are D-03.

### US-04: Use a daily learning queue

As a learner, I can see the verses I should practise today.

- The queue reflects only my eligible learning items and the selected practice
  day; it does not expose another account's items.
- Queue retrieval itself does not award progress or alter mastery.
- After an accepted attempt, refreshing the queue reflects committed progress.
- Empty, loading, and failed-load states are distinct and understandable.
- Eligibility after a same-day success, ordering, daily limits, and whether due
  reviews share this screen are D-04. Do not invent a default queue size.

### US-05: Recite by typing

As a learner, I can type a recitation and understand its assessment.

- A valid submitted recitation is compared with the selected verse using the
  approved assessment policy, not a success flag supplied by the browser.
- Feedback distinguishes assessed success, assessed failure, and technical error.
- Repeating a request after a connection interruption cannot award progress twice.
- Unsupported, empty, or excessive inputs are rejected with useful feedback;
  concrete input limits must be defined before implementation (D-13).
- Exact matching, tolerances, reference inclusion, hints, and annotation treatment
  remain D-05; no text normalisation is implicitly approved.

### US-06: Recite by voice

As a learner, I can speak a verse and receive an assessment.

- Capture starts only after an explicit action and the required microphone grant.
- A completed transcript uses the same approved assessment rules as typed text.
- Interim transcripts cannot commit progress; technical failures cannot count as
  wrong recitations, successful days, or completed reviews.
- Denial, unsupported APIs, absent microphone, silence, cancellation, timeout,
  provider/network error, and expired authentication have distinct recovery paths.
- Typing remains available when voice is unavailable; no automatic re-recording
  or background upload occurs after cancellation.
- Provider, supported environments/languages, correction of transcripts,
  recording limits, consent, and retention policy are D-06 and D-13.

### US-07: Configure and reach mastery

As a learner, I can choose how many consecutive successful days establish mastery.

- The threshold represents a positive whole number of distinct consecutive days.
- Multiple successes on one day cannot satisfy multiple days of the requirement.
- Reaching the effective threshold transitions the item from learning to mastered.
- A gap in successful calendar days breaks the consecutive run; previous success
  history is not fabricated or erased to disguise the gap.
- Settings are validated and persisted for the owner. The default, maximum,
  per-user/per-item scope, and effect on existing progress are D-07.
- Mixed success/failure within a day and failed-attempt reset behaviour are D-08.

### US-08: Track a daily practice streak

As a learner, I can see a streak that represents consecutive practice days.

- Each qualifying calendar day contributes at most one day to the streak.
- Repeated same-day activity cannot inflate the count; a non-qualifying day breaks
  continuity, subject to the current-day display rule in D-09.
- Merely opening the app, loading the queue, or experiencing a technical failure
  does not qualify as assessed practice.
- Streaks are account-specific and distinct from each verse's mastery run.
- Whether failed assessments or reviews qualify, and how to display yesterday's
  streak before practice today, are D-09. Time attribution follows section 5.

### US-09: Review mastered verses

As a learner, I am prompted to review mastered verses at spaced intervals.

- Reaching mastery establishes review eligibility under an approved schedule.
- Due and overdue items remain discoverable; reading the due list does not
  silently mark a review complete.
- Accepted reviews persist their outcome and scheduling effect exactly once.
- A transcription error or rolled-back save cannot advance a review schedule;
  an unknown save outcome must be reconciled, not assumed to have rolled back.
- Exact intervals, algorithm, overdue treatment, failed-review response, and
  whether failed recall returns an item to learning are D-10.

### US-10: Use an accessible, responsive PWA

As a learner, I can read and practise on small and large screens, using assistive
technology or a keyboard, and install the app where supported.

- Core flows have semantic controls, accessible names, visible focus, logical
  focus order, non-colour-only feedback, and accessible status/error announcements.
- Text can be enlarged and content reflows without hiding essential controls.
- Voice is optional; the typing path supports the core learning workflow.
- Unsupported installation does not prevent use in a normal browser.
- Connectivity failures are explicit and do not produce false saved-state claims.
- Accessibility conformance target, browser matrix, install assets, and offline
  content/progress guarantees are D-11; PWA does not imply offline mutation sync.

## 4. Learning and mastery state rules

Conceptual persisted learning states are **learning** and **mastered**. Not added
means no learning record. Queue eligibility and review due status are derived
conditions, not additional mastery states. Paused/archived states are not required.

| Current state | Event | Required effect / unresolved condition |
| --- | --- | --- |
| No record | Add an available verse | Create owner-scoped learning progress |
| Learning/mastered | Duplicate add or retried command | Preserve existing progress; no duplicate award/reset |
| Learning | Accepted success on an eligible day | Update the successful-day run; master when the effective threshold is reached |
| Learning | Further success on the same day | Cannot add a second successful day |
| Learning | Next success after a gap | Starts a new consecutive run; evaluate threshold against that run |
| Learning | Assessed failure | Record the outcome; run/reset and same-day recovery policy is D-08 |
| Learning | Threshold setting changes | Re-evaluation timing and retroactive effect are D-07 |
| Mastered | Accepted review success/failure | Apply approved review policy; demotion is not assumed (D-10) |
| Any | Capture/transcription/validation error or rolled-back save | No success credit, no wrong-answer penalty, no completed review |
| Any | Lost response / unknown commit outcome | Reconcile authoritative state using the same operation identity; never award twice |

A successful-day counter can be stale after midnight without a mutation: display
and eligibility must consider the last credited date, not trust a stored count
alone. Completing an attempt and crediting a day are separate concepts. The
approved D-08 policy must resolve whether a later failure can affect earlier
same-day credit. History, counters, and displayed state must agree.

## 5. Streak and timezone rules

### Required invariants

- Consecutive days mean adjacent calendar dates, not elapsed blocks of 24 hours.
- All day-based features use one explicit day-attribution policy per account;
  queue, mastery, streaks, and reviews must not silently use different zones.
- Daylight-saving days may contain 23 or 25 hours; neither awards nor removes a
  calendar day merely because of elapsed duration.
- A retry, second device, or manipulated browser clock cannot award extra days.
- An operation spanning midnight must be attributed consistently, including when
  transcription finishes later. The selected event boundary is D-12.

### Proposed implementation policy, awaiting D-12

Use a validated account IANA timezone, a trusted server clock, UTC event instants,
and an attributed local date with the timezone used at acceptance. Preserve that
context so past activity is not silently rebucketed when the account zone changes.
Do not hard-code the server timezone, assume UTC is the user's day, or calculate
tomorrow by adding 24 hours. Initial zone selection, travel/zone-change effective
time, historical rebucketing, and offline/backdated submissions remain unresolved.

## 6. Review scheduling rules

- Schedules belong to the owner's mastered learning item and use an explicit
  next-due value and policy; there is no hidden scheduling default.
- Due evaluation uses the approved time model. Whether due values are calendar
  dates or instants is part of D-10/D-12.
- Outcomes and schedule changes commit together; retries do not advance twice.
- Technical failures do not themselves constitute a review outcome. Rolled-back
  saves leave the schedule unchanged; unknown commits require reconciliation.
  Overdue items cannot disappear solely because the original due date passed.
- Spaced repetition requires defined successive review spacing. No interval list,
  adaptive formula, scheduler service, or cron job is required by this document.
- D-10 must define first-review timing, later intervals, success/failure effects,
  interval anchor (scheduled due versus actual completion), early reviews, repeated
  same-day reviews, missed reviews, and changes to the scheduling policy.

## 7. Security, privacy, and failure requirements

- Derive identity from verified authentication, never a caller-provided owner ID.
- Enforce ownership for every private read, list, create, update, and delete at
  the trusted persistence boundary. UI filtering is not access control.
- Validate external payloads, routes, configuration, stored values, Bible JSON,
  and transcription responses before use. Bound expensive operations (D-13).
- Do not send Bible translations to an external translation API. Any speech
  provider receives only data necessary for the approved transcription flow.
- Never log credentials, raw audio, full recitations, or other sensitive user data
  by default. Retention/deletion decisions are D-02/D-06.
- Private caches must not expose a previous user's progress after account changes.
- A lost response may mean a command committed: retry with the same operation
  identity or reload state rather than blindly applying progress again.
- Missing dependencies, provider outages, or permission failures are visible
  operational errors, not evidence of a learner's success or failure.

## 8. Decision register

These are implementation gates, not permission to choose arbitrary defaults.
Resolve a decision in this document with concrete examples before writing its
failing behaviour tests. Architecture should remain adaptable without building
multiple speculative implementations.

| ID | Decision to resolve | Affected scope |
| --- | --- | --- |
| D-01 | Public reader access, book ordering/display names, annotations presentation, navigation/search scope | US-01 |
| D-02 | Sign-in methods, recovery, session expiry, account deletion and progress retention/export | US-02, security |
| D-03 | Multi-verse passages, remove/pause/restart semantics; single verses are the baseline learning unit | US-03, state model |
| D-04 | Queue eligibility, completion/re-entry, ordering, capacity, and review presentation | US-04 |
| D-05 | Success definition: case, punctuation, whitespace, spelling, word omissions/order, reference recitation, hints, paragraph markers and embedded notes | US-05/06, mastery |
| D-06 | Browser versus server speech recognition, provider, language/browser support, transcript correction, audio consent and retention | US-06, privacy |
| D-07 | Mastery threshold default/range/scope; when changes affect learning and mastered records | US-07 |
| D-08 | Failed recitation effect; same-day mixed outcomes and retries; whether success seals day credit | US-05/06/07 |
| D-09 | Qualifying streak activity, review/failed-attempt eligibility, current-day display and longest-streak display | US-08 |
| D-10 | Review algorithm/intervals, due representation, anchors, early/overdue/repeated reviews, failure/demotion and policy changes | US-09 |
| D-11 | Accessibility target, browser/device matrix, PWA installation details, offline reader scope and offline writes/sync | US-10 |
| D-12 | Timezone selection/changes, authoritative event boundary, midnight attribution, backdating/offline activity and rebucketing | All daily behaviour |
| D-13 | Input/audio/duration limits, timeouts, abuse controls and measurable performance targets | Validation, voice, operations |

## 9. Non-goals and deferred features

Not part of the requested baseline: additional translations, external Bible APIs,
social feeds, leaderboards, sharing groups, AI commentary, subscriptions, and
administrative dashboards. No microservices, event bus, or separate scheduling
service is justified by the current requirements.

Deferred pending explicit decisions: passage learning and lifecycle controls
(D-03), reader search (D-01), reminders/push notifications, offline progress sync
(D-11), transcript editing and retained recordings (D-06), and advanced learning
analytics. Do not promise these or implement them incidentally.

## 10. Verification and implementation readiness

The testing strategy is in [architecture.md](architecture.md). Every implemented
behaviour requires an observed RED -> GREEN -> REFACTOR cycle under AGENTS.md.

- [ ] Link every implemented story to deterministic acceptance tests.
- [ ] Resolve applicable D-xx decisions before implementing policy.
- [ ] Cover invalid inputs, errors, calendar boundaries, retries, and ownership.
- [ ] Run relevant unit, integration, component, and E2E checks for the change.
- [ ] Run configured lint, strict type checking, and applicable builds.
- [ ] Verify keyboard/screen-reader behaviour and PWA behaviour on agreed targets.
- [ ] Preserve source Bible files and real user data.
- [ ] Report exact commands, results, and unavailable checks.

For this documentation-only task, review content, links, coverage, and consistency;
do not invent application tests or commands. Available tooling is documented in
[development.md](development.md).
