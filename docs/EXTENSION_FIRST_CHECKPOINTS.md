# Extension-first refactor: checkpoint log

Gate evidence for [the refactor plan](EXTENSION_FIRST_REFACTOR_PLAN.md), one
section per checkpoint, newest last. Each entry records the commit, the
changes, the exact commands and results, what was not executed, migration
status, the rollback boundary, and a PASS/BLOCKED decision.

## Standard gate

Every checkpoint runs the same commands from the repository root:

| Check | Command |
| --- | --- |
| Unit, integration, migration | `pnpm test` |
| Types | `pnpm typecheck` (all packages plus the browser tests) |
| Lint | `pnpm lint` (root scripts, packages, extension with zero warnings; web capped at its recorded warnings) |
| Browser | `pnpm test:e2e` (Playwright, bundled Chromium, isolated QA server) |
| Production builds | `pnpm build` with the dummy environment below |
| Manifest | `pnpm extension:check-manifest` |

```sh
BETTER_AUTH_SECRET=ci-only-better-auth-secret-that-is-long-enough \
BETTER_AUTH_URL=http://localhost:3000 \
GOOGLE_CLIENT_ID=ci-google-client GOOGLE_CLIENT_SECRET=ci-google-secret \
ANKIFY_EXTENSION_API_ORIGIN=https://ankify.example.com \
ANKIFY_EXTENSION_ORIGINS=chrome-extension://abcdefghijklmnopabcdefghijklmnop \
AI_KEY_ENCRYPTION_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
TURSO_DATABASE_URL= TURSO_AUTH_TOKEN= LOCAL_DB_PATH=/tmp/ankify-build.db \
pnpm build
```

The recorded web lint warnings are all
`@next/next/no-location-assign-relative-destination`: three in
`problems-client.tsx`, one in the settings form, and one in `nav.tsx`. There
were seven until 6B.2 removed `review-client.tsx` with its two. `apps/web`
lint runs with `--max-warnings=5`, so any new warning fails the gate; lower
the cap as those files change.

## Checkpoint 0: baseline, harness, and characterization

Status: **PASS with two recorded exceptions**, see below. Recorded on
2026-09-29, Node 22.17.0, pnpm 10.25.0, macOS, at commit `6563b65`.

A Codex pass wrote the plan, the characterization tests, the browser harness,
lint coverage, and the capabilities contract, but could not run the
production build or the browser suite: its sandbox blocked Turbopack from
binding a port. Re-executed outside that sandbox, both pass. Codex's webpack
workaround (`serverExternalPackages` for libSQL, a `build:webpack` script, and
an extra `@libsql/client` dependency) was removed: Next already externalizes
both libSQL packages, and Turbopack is the production bundler.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 223 tests in 38 files (205 baseline plus characterization) |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS: seven recorded web warnings; extension, packages, and root scripts clean |
| `pnpm test:e2e` | PASS: 2 tests (extension loads, QA authentication, fixture capture and save, capture replay after a real service-worker termination, signed-out state) |
| `pnpm build` | PASS (Next.js 16.3.6, Turbopack) |
| `pnpm extension:check-manifest` | PASS: 0.2.1, three permissions, two exact hosts |

Delivered:

- Characterization tests for capture (idempotency, recapture preserving notes
  and schedules, user isolation, atomic rollback, the then-current
  suppression of distinct submission ids), ratings (replay, conflicts, Undo
  restoring every FSRS field, ownership, rollback), and the legacy queue DTO.
- A protected-history migration test: raw-SQL fixtures seeded at migration
  0019 and 0020 must survive every later migration, re-migration, export,
  and account deletion unchanged. Every future migration runs through it.
- Playwright harness (`playwright.config.ts`, `scripts/e2e-server.mjs`,
  `tests/e2e/`): a throwaway QA database, no Turso/AI/Stripe credentials,
  fixture LeetCode pages and GraphQL, all other external requests blocked, a
  separate Next distDir so it can run beside `pnpm dev`. CI runs it.
- Lint coverage for the extension, the shared packages, and root scripts.
- `GET /api/capabilities` (authenticated, `private, no-store`), advertising
  only implemented workflows.
- `scripts/leetcode-live-probe.js`: a read-only DevTools snippet that checks
  the live GraphQL fields the adapter depends on and reports only shapes,
  counts, and booleans.

Recorded exceptions:

1. **Live LeetCode validation: pending.** It needs a signed-in LeetCode
   account, which automated checks cannot use. The probe above is ready; its
   report must be recorded here before Phase 3 relies on submission-list
   pagination, account identity, or history coverage. Phases 1 and 2 are
   server-side and depend on none of these; the owner approved proceeding
   with them meanwhile.
2. **Deployment dispatch recovery: deferred to Phase 4B.** `apps/web/vercel.json`
   has a queue trigger and no cron, and the Vercel tier is unverified (Hobby
   cron runs at most daily). Per the plan, only *automatic* analysis depends
   on recovery; manual analysis does not. Automatic analysis stays disabled
   until recovery is demonstrated on the deployment, including a fallback
   that re-dispatches a user's stranded jobs on their next request.

Integration facts established from code (not yet live): the adapter reads
the latest 20 submissions at offset 0 and fetches details with concurrency
four; listing failures and signed-out responses both collapse into an empty
list, and missing details are dropped. New tracking must expose
unavailable/partial states and never treat an error as zero attempts.

No migration was generated or applied. Rollback: every Phase 0 change is test,
tooling, or documentation, except the capabilities route, which is additive.

## Checkpoint 1.1: submission identity

Status: **PASS**. Commit `f2c813a` on top of `6563b65`.

Changes: `server/submission-store.ts` owns submission identity for capture
(and, later, session ingestion). A LeetCode submission id identifies an
attempt; identical code under different ids stays distinct. Repeated delivery
fills in missing details without overwriting stored values; an id stored under
another problem is a conflict and is never reassigned; id-less payloads keep
the legacy content deduplication, including its within-batch normalization;
over-cap submissions are counted. `CaptureResultDto` gains
`duplicateSubmissions`, `enrichedSubmissions`, `conflictingSubmissions`, and
`capacityBlockedSubmissions`; existing fields keep their meaning, so old
clients are unaffected.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 227 tests in 38 files |
| `pnpm typecheck`, `pnpm lint` | PASS (lint back to exactly seven web warnings, now enforced) |
| `pnpm test:e2e` | PASS: 2 tests, including the legacy capture payload |
| `pnpm build`, manifest | PASS |

New tests: identical code under different ids across and within batches,
enrichment without overwrite, cross-problem id conflict, id-less
deduplication, and the per-problem cap. No migration. Rollback: revert the
commit; no stored data changes shape.

## Checkpoint 1.2: session schema and contracts (M1)

Status: **PASS**. Commit `6bf6a8f`.

Migration `0021_m1_practice_sessions` is additive (new tables, `ADD COLUMN`
with defaults, new indexes; no table rebuild). It adds `practice_sessions`,
`practice_session_submissions`, `practice_session_commands`,
`problems.schedule_revision` (0) and `problems.enrollment` (`enrolled`), and
session/policy/method/revision provenance on `review_events` (NULL for
existing rows). Database-level invariants: one open session per problem, a
composite foreign key pinning observations to their session's user and
problem, one session per LeetCode submission id per user and site, an
observation identity check, and at most one rating and one initial-scheduling
event per session.

The legacy rating route now advances `schedule_revision` (rating and Undo),
records `legacy_self_recall_v1` / `self_recall` provenance, and refuses
problems awaiting initial learning; the due condition excludes them. Pure
session rules are in `@ankify/core`, wire contracts in `@ankify/contracts`.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 257 tests in 41 files |
| `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e`, `pnpm build`, manifest | PASS |

Migration evidence: the protected-history test upgrades the 0019/0020
fixtures through M1 and asserts unchanged rows, `schedule_revision = 0`,
`enrollment = 'enrolled'`, NULL provenance, no observations, a clean
`PRAGMA foreign_key_check`, and idempotent re-migration. The 0016 billing
upgrade test now seeds with raw SQL (the ORM schema is newer than that
database). Rollback: code can roll back freely; the additive schema stays.

## Checkpoint 1.3: session lifecycle, API, and export

Status: **PASS**. Commit `e267a7f`. **Phase 1 gate: PASS.**

Routes: `POST/GET /api/practice-sessions`, `GET /api/practice-sessions/current`,
`GET /api/practice-sessions/:id`, `POST .../:id/commands`,
`POST .../:id/submissions`, all authenticated, validated by
`@ankify/contracts`, returning DTOs, and rate limited (`sessions`, 120/min).
Capture and session start share `server/problem-upsert.ts`. The export adds
`practice_session` (without owner tokens) and `practice_session_submission`.
`ANKIFY_DISABLED_WORKFLOWS` disables a workflow and removes it from
capabilities; `practice_sessions` is advertised.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 295 tests in 46 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm test:e2e`, `pnpm build`, manifest | PASS |

Tests added: 29 lifecycle/observation integration tests (initial learning
creation, replay and payload conflicts, kind selection, resume and
ownership, open-session conflicts, account mismatch, stale release,
explicit rating supersession, heartbeats and timing caps, takeover, finish
outcomes and clamping, abandon, defer/dismiss/expiry/supersession, baseline,
user isolation, details and enrichment, historical and ambiguous
placement, linking captured details, cross-session conflicts, the per-problem
cap, late observations, pagination, export, and FSRS isolation); three race
files (starts, duplicated finish, duplicated observation), each run three
times; five route tests. Two deliberate mutations (dropping the finish
owner check; accepting historical observations) each failed the suite.

Acceptance: every distinct identified submission survives; duplicate delivery
creates no extra submission, observation, or session; no session operation
changes FSRS state or the schedule revision (asserted end to end). Old
extension capture payloads are unchanged (browser suite).

Not executed: live LeetCode validation (see checkpoint 0). Rollback: set
`ANKIFY_DISABLED_WORKFLOWS=practice_sessions`; M1 and the identity fix stay.

## Checkpoint 2.1: scheduling policies

Status: **PASS**, gated in isolation at commit `bac7a8b` (300 tests in 46
files; all six checks passed).

`leetcode_full_solve_v1` (default weights, 90% retention, fuzz, short-term
steps disabled), `initial_delay_v1` (first review 1-168 h after initial
learning, default 24 h, state stays `new`), `retrievabilityEstimate()`
(`null` for never-reviewed problems), and `initialReviewDelayHours` in review
settings and the settings API. A read-only probe of ts-fsrs 5.4.1 confirmed
day-based outcomes for all four grades from new, review, and legacy learning
and relearning states. Legacy FSRS tests are unchanged.

## Checkpoint 2.2: transactional session rating

Status: **PASS**. Commit `96385fd`; gate: 314 tests in 48 files, typecheck,
lint (seven warnings), browser suite, builds, manifest.

`POST /api/practice-sessions/:id/rating`, initial scheduling on finish, and
exact Undo (`undo_rating` and the legacy route) as described in
ARCHITECTURE.md. Tests: first-review initialization (with configured delay),
abandoned and interrupted initial learning never scheduling, one schedule
update per session, rating 20 hours after completion scheduled from the
completion time (checked against `rateFullSolve`), response-loss replay,
different request ids for one session, stale revision after a legacy
rating, Undo restoring every FSRS field and blocking any re-rating or
replay, legacy Undo marking the session undone, Undo conflict after a newer
change, failed review rated Again, deferred and early reviews rated,
dismissed/expired/voluntary/abandoned/unfinished never rated, and daily
counts excluding initial learning. A race file runs duplicated and distinct
rating requests concurrently (one event, one schedule update), three times.
Mutations (rating at the rating time; replay after Undo) failed the suite.

## Checkpoint 2.3: queue, statistics, and compatibility

Status: **PASS**. Commit `5c999ed`. **Phase 2 gate: PASS.**

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 320 tests in 50 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm test:e2e`, `pnpm build`, manifest | PASS |

`GET /api/review/overview` (due within the daily limit, most overdue first;
upcoming; pending ratings; open sessions; separate counts for reviews,
initial learning, and completed sessions). The problems list and problem page
show "Not scheduled yet" for problems awaiting initial learning; review-ahead
refuses them. Migration: no schema change in Phase 2 (the session command
enum is application-level); existing scheduling values stay byte-identical
(protected-history test).

Acceptance: no invented initial recall rating, no default rating, no
schedule change from capture, voluntary practice, or dashboard reads, and no
duplicate scheduling. Browser coverage of finish → rate → postpone arrives
with the extension workflow in Phase 3. Rollback:
`ANKIFY_DISABLED_WORKFLOWS=session_rating`; already-written states and events
stay and are not rewritten.

## Checkpoint 3.1: durable transport

Status: **PASS**. Commit `f718016`; gate: 338 tests in 54 files, typecheck,
lint, browser suite, builds, manifest.

Background API client with failure classes (sign-in, rate limited with
Retry-After, network, server, rejected); an IndexedDB outbox that persists
before sending, replays with the same id, keeps per-session order, pauses on
401, records rejections, holds storage-cap parts for the user without blocking
later work, and never replays across accounts or API origins; zod-validated
messages with sender checks (top-frame LeetCode problem pages; this
extension's pages). Unit tests use an in-memory store and `fake-indexeddb`
(dev-only), including a reopened database as after a worker restart.

## Checkpoint 3.2: capture and session controller

Status: **PASS**. Commit `d76975f`; gate: 369 tests in 58 files and 3
browser tests.

LeetCode adapter with explicit availability, lastKey pagination with a
single-page fallback, baseline stop, and account read; page session with
foreground-only activity, 15 s polling while visible, immediate polls on
focus and start, backoff, and a final poll before Finish; background session
controller (tab tokens in `chrome.storage.session`, online starts, durable
finish/abandon/ratings/observations, `chrome.alarms` retries; new `alarms`
permission). A browser test opened a due review from the extension and saw
the new tab set the baseline and record a later Accepted submission.

## Checkpoint 3.3: popup and in-page panel

Status: **PASS**. Commit `32b243c`; gate: 373 tests in 59 files and 10
browser tests.

Toolbar popup and shadow-root panel as described in ARCHITECTURE.md; explicit
editor reset; history import for problems in the deck; the legacy popup and
its dependencies removed (popup bundle 427 kB to 209 kB). Browser testing found
and fixed: messages classified by a stale sender URL after LeetCode's
pushState navigation, the panel keeping pre-finish problem state, and
observation responses clearing ownership.

## Checkpoint 3.4: cutover readiness

Status: **PASS**. Commit `cc679c7`. **Phase 3 gate: PASS with the live
LeetCode exception below.**

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 377 tests in 60 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 15 tests, twice in a row |
| `pnpm extension:check-manifest` | PASS: 0.3.0, `storage`/`tabs`/`alarms`, popup, no side panel |

Legacy review guard behind `ANKIFY_DISABLED_WORKFLOWS=legacy_review` (426
`upgrade_required`, advertised in capabilities); durable work scoped by a
freshly confirmed account (fixes a real cross-account drop found while
writing the account-switch test; a mutation test confirms the guard); server
capability banner; extension 0.3.0; release and cutover order in
DEPLOYMENT.md.

Phase 3 browser coverage: popup close, reload, SPA navigation, browser close
and reopen on the same profile, worker termination with a queued finish,
same-problem tabs with explicit takeover, account switching, Accepted then
continued work, failure then Again, deferred rating, history import, notes,
both languages. Sender validation, message bounds, and invalid problem URLs
are unit-tested.

Acceptance: an authenticated user completes initial learning and a scheduled
review entirely on LeetCode plus the extension, without a web review page
(browser suite, fixture LeetCode).

Recorded exception: **live LeetCode validation is still pending**
(`scripts/leetcode-live-probe.js`). The adapter degrades to explicit
unavailable/partial states and a single page if LeetCode rejects pagination
fields; field shapes, pagination, and account identity are validated only
against fixtures until the probe report is recorded here.

Rollback: switch off `practice_sessions`/`session_rating`; publish a higher
extension version to undo an extension release (installed versions cannot be
downgraded). The legacy routes stay available until the cutover switch.

## Checkpoint 4A: deterministic session evidence and mistake profile

Status: **PASS** (live LeetCode exception from Phase 3 unchanged). Commit
`8da210e`. Migration `0022_m2_session_evidence` (additive, not yet applied to
Preview or Production).

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 402 tests in 63 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 15 tests |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

Changes: mistake records gain a practice-session reference (set directly or
derived from a session's submission or rating) and structured evidence
references (observation, submission, code range, judge output) validated
against the user, problem, and session; `practice_improvements` for explicit
improvement confirmations; session summaries (verdict and correction
sequence) on the session detail; `computeMistakeProfile()` in core and
`GET /api/mistakes/profile`, `POST/GET /api/mistakes/improvements`,
`DELETE /api/mistakes/improvements/:id`; export of improvements. Details in
MISTAKE_PROFILE_PLAN.md.

Tests cover repeated imports, same-session retries (three records on three
failed submissions stay visible and count as one context), a user's
submission record plus a confirmed AI finding from one session counted once,
legacy source contexts, resolution, Undo removing the rating's contribution
while the user's record stays, readiness thresholds, improvements (replay,
conflict, dedupe, open session, isolation), and user isolation. Mutation
checks: restoring session-wide dedupe and counting undone ratings each fail a
test.

Found and fixed while testing:

- The first session dedupe index covered every record with a session, so a
  second note on a different failed submission of the same session was
  silently merged into the first. The plan requires every visible record to
  survive, so the index now covers only records made on the session itself
  (`source_type = 'practice_session'`); scoring deduplicates contexts.
- `ALTER TABLE ... ADD evidence ... DEFAULT (json('[]'))` passes on an empty
  table but SQLite rejects a non-constant default when rows exist, so the
  migration would have failed on Production. The protected-history test
  (which migrates over existing mistake rows) caught it; the default is now
  the constant `'[]'`.
- The profile loader passed every in-window id as query parameters; it now
  uses user-scoped joins, so long histories cannot hit the host-parameter
  limit.

Deviation from the plan: no `practice_evidence` table. Normalized profile
inputs are computed on every read from user-scoped joins over the 90-day
window. Nothing derived is stored, so Undo, dismissal, resolution, and
deletion can never leave a stale score, and there is no backfill or
invalidation path to get wrong. Revisit if profile reads become slow.

Rollback: stop calling the new routes; the columns and table are additive
and unused by earlier code. The deterministic profile has no AI dependency.

## Checkpoint 4B: BYOK session analysis

Status: **PASS with the recorded exceptions below**. Commit `2048edb`.
**Phase 4 gate: PASS** (4A and 4B). Migration `0023_m2_session_analysis` (additive, not yet applied
to Preview or Production; apply `0022` and `0023` before deploying this code,
see DEPLOYMENT.md).

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 440 tests in 67 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 18 tests (three new analysis tests) |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

Changes:

- `session_analyze` AI job through `POST /api/ai-jobs`. It runs only on the
  user's own key, checked at creation and again before execution; there is no
  hosted fallback and no credit spend. One provider call per attempt, three
  attempts. Output is schema-validated once; invalid output fails at once
  (`ai_output_invalid`), with no repair.
- Bounded evidence (32,000 characters): the verdict sequence, representative
  code revisions (diffs where shorter), and judge output. Omissions are listed
  in `coverage`. Attempt labels (S1 to S99) resolve to observations and code
  ranges.
- `session_analyses`: immutable rows cached by (user, session, evidence
  digest, analyzer version, provider, model), stale on read. Findings become
  `ai_suggested` candidates, one per category not yet recorded for the
  session. They commit with the analysis and the terminal job state.
- Budgets: manual 10 per local day; automatic 0 to 5 per day (default 2).
- Automatic analysis:
  - opt-in per user;
  - planned inside the finish or improvement transaction for qualifying
    sessions (repeated failures then Accepted, recurrence of a confirmed
    pattern, an improvement test);
  - at most one per session;
  - offered only when `ANKIFY_AUTOMATIC_ANALYSIS=enabled`.
- Dispatch recovery: `ai_jobs.dispatched_at`, and `redispatchStrandedJobs()`,
  which runs from the popup overview, the analysis state route, and
  `GET /api/cron/ai-dispatch` (Bearer `CRON_SECRET`).
- A request id replayed for a different command returns
  `409 ai_job_request_conflict`.
- Capabilities advertise `sessionAnalysis`, and the settings route accepts the
  automation fields.
- Extension: `analysis_state`, `analysis_start`, and `analysis_finding`
  messages. The panel shows the analysis status, the summary, and each finding
  with confirm, recategorize, and dismiss controls.
- Browser harness: a fake OpenAI-compatible provider on :4318, plus the QA
  worker.

Tests:

- Unit: eligibility, prompt selection and bounds, evidence digest, schema
  validation, and budgets.
- Integration:
  - duplicate requests and deliveries, lease expiry, redelivery after commit;
  - publication failure, both manual and automatic;
  - cancellation, stale evidence;
  - a removed key, with no hosted fallback; a changed provider or model;
  - the kill switch stopping queued work.
- Automatic triggers: firing, never firing for ordinary practice, and daily
  limits.
- Page-session polling.
- `recentCompleted`.
- The protected-history migration test now migrates over a populated `ai_jobs`
  table.
- Browser: automation off and on; manual analyze, confirm (recategorized) and
  dismiss; the no-key state.
- Mutation checks: the BYOK-only rule and the cache lookup; the kill-switch
  guard in the executor; the panel's polling through a failed read and its
  resumption.

Found and fixed while gating:

- `ANKIFY_DISABLED_WORKFLOWS=session_analysis` refused new jobs, but queued
  jobs, including stranded ones re-sent by recovery, still called the user's
  provider. The executor now checks the switch first and fails the job with
  `workflow_disabled` before any provider call, as the plan's rollback
  requires.
- The panel stopped polling after a single failed read, and never read again
  after its five-minute limit, so a running job could show "Analyzing"
  indefinitely. Polling now continues through failed reads, a successful read
  clears the stale error, and a running analysis is read again when the page
  becomes active.
- Two existing exact-equality tests predated the contract additions
  (`recentCompleted` on the current-session DTO, and the `analysis_state` read
  after Finish). Both were updated to assert the new fields.

Acceptance:

- Ordinary visits and submissions create no AI calls (integration test).
- Each eligible evidence version has at most one committed analysis (cache
  unique index, cache and redelivery tests).
- Only confirmed findings affect the profile (browser and profile tests).

Recorded exceptions:

- **Automatic analysis stays unavailable** until the dispatch-recovery cron is
  scheduled and verified (DEPLOYMENT.md). `vercel.json` has no cron until the
  plan tier is verified.
- **Never run against a real provider.** Only the fake provider and mocked
  models have produced analyses, so structured output from OpenAI, Anthropic,
  and DeepSeek is unverified.
- The Phase 3 **live LeetCode validation is still pending.**

Rollback: add `session_analysis` to `ANKIFY_DISABLED_WORKFLOWS`; new jobs are
refused and queued ones fail before any provider call. To stop only automatic
analysis, unset `ANKIFY_AUTOMATIC_ANALYSIS`. The schema changes are additive:
analyses, candidates, and confirmed mistakes stay, and the deterministic
profile has no AI dependency.

## Checkpoint 5.1: suggestion metadata and attempt history

Status: **PASS** (live LeetCode exception unchanged). Migration
`0024_m3_attempt_history` (additive; not yet applied to Preview or
Production).

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 453 tests in 70 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 18 tests |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

Changes:

- `suggestion_candidates`: per-user LeetCode metadata (title, difficulty, paid
  flag, topics) with a source and a verification time.
  - The extension's adapter now keeps a similar question's metadata only when
    LeetCode reported every field.
  - `upsertLeetcodeProblem()` records candidate metadata in the same
    transaction, for both capture and session start.
  - Newer reads refresh the metadata; the first source's topics are kept.
  - Per-user cap: 5,000 candidates.
- `attempt_history`: attempted problems by slug and source (`user_marked`,
  `leetcode_status`, `deleted_problem`), independent of problem rows.
  - Accepted never downgrades to attempted.
  - `DELETE /api/problems/:id` records the slug in the same transaction before
    deleting, so a deleted problem can never be suggested as new.
- `attempt_history_coverage`: how far a LeetCode problem-list read got, per
  scope and account. Only a scope read to its end counts as complete.
- A shared `leetcodeSlugSchema` in contracts, used by the extension protocol,
  and the attempt-history merge contract.
- Cold-start catalog:
  - `scripts/leetcode-catalog.js` generates it from LeetCode's problem list
    (read-only, no per-user fields; rule: the first six free Easy and Medium
    problems per topic).
  - The loader validates it, and entries without a generation time are never
    used. The committed catalog is empty.
- The account export now includes session analyses, which 4B had missed, and
  the attempt history and its coverage.

Deviation from the plan: no backfill of captured problems into
`attempt_history`. Problem rows, archived ones included, are read directly as
attempted, and deletion writes the slug first. This leaves no stale copy and
no second write path to keep consistent.

Tests:

- Contracts: similar-question and slug validation, history-merge refinements.
- Adapter: similar-question parsing, where incomplete metadata is dropped but
  the slug is kept.
- DB:
  - candidates recorded through a real session start;
  - refresh, topic retention, and old-client payloads;
  - the cap, while known candidates still refresh;
  - history merge per source, including accepted monotonicity;
  - coverage per scope and account;
  - deletion through the route (accepted when solved, attempted from a failed
    observation, owner-only, 404 for another user's problem);
  - known attempted slugs, archived included;
  - export scoping;
  - cascade on user deletion;
  - upgrading invents no history, candidates, or coverage.
- Mutation checks: removing the deletion record, letting accepted downgrade,
  and removing the cap each fail a test.

Recorded exceptions:

- **The cold-start catalog is empty** until the owner runs
  `scripts/leetcode-catalog.js` in a leetcode.com tab (DEPLOYMENT.md).
- The generator's `questionList` filter fields are unvalidated. They fail
  loudly if LeetCode rejects them.

Rollback: nothing reads the new tables for suggestions yet. Candidate
recording and deletion history are additive writes.

## Checkpoint 5.2: new-problem planner

Status: **PASS**. Pure core module; no schema or API change.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 460 tests in 71 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 18 tests |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

`planSuggestion()` in `packages/core/src/suggestions/` adapts the daily
feed's engine to new problems only. It keeps the weakness shares,
deficit-based weighted rotation, and seeded `unitHash` tie-breaks, and drops
drills and quiz retries.

- Input weakness: the 4A profile's categories, with readiness. Only
  dimensions both weak and confirmed across problems are targeted, and only
  once the profile is personalized; otherwise the pick is labeled general
  practice.
- Eligibility: verified metadata, free, not attempted (problem rows and
  attempt history), not pending, and not suggested in the last 30 days.
- Targeted ranking:
  - similar questions of problems with confirmed mistakes in the dimension;
  - then topic affinity (the dimension's confirmed contexts split across
    topics);
  - then same-or-easier difficulty.
- General practice ranking: the user's practiced topics, similarity to a
  practiced problem, and the recent median difficulty (Easy with no history).
- Explanations state only what metadata shows. "Similar to X" carries a
  category only when that category was confirmed on X, and a topic-only match
  is a topic. General practice says why: not personalized, no focus, rotation,
  or no targeted candidate.
- The seed is the user, local date, ordinal, and planner version
  (`suggestions-v1`, stored with each suggestion from 5.3).

Tests:

- scoring and explanation;
- every eligibility exclusion, including the 30-day boundary;
- truthful general-practice labels;
- cold start by topic and difficulty;
- determinism, with variation across ordinals and users;
- a topic-only explanation;
- a 28-day rotation over two weak dimensions: shares within 0.1 of 0.50,
  0.35, and 0.15, no weak dimension unserved for more than 7 days, and no
  repeated target.

Mutation checks, each failing a test:

- dropping the 30-day exposure;
- ignoring readiness;
- removing the rotation's served counts;
- labeling a topic-only match as similar.

## Checkpoint 5.3: suggestion persistence and API

Status: **PASS**. Migration `0025_m3_suggestions` (additive; not yet applied
to Preview or Production). `suggestions` is now an implemented workflow.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 476 tests in 75 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 18 tests |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

Changes:

- The `suggestions` table freezes each target, its explanation, the planner
  version, the metadata's verification time, and a novelty label. Unique
  indexes cover (user, local date, ordinal), (user, request id), and (user,
  slug) while pending.
- `POST /api/suggestions`:
  - `daily` allocates the day's suggestion once and later returns it;
  - `extra` appends the next ordinal, at most 20 a day;
  - nothing is stored when no problem is eligible;
  - replays are by request id, and reusing a request id for the other kind is
    a `409`.
- `POST /api/suggestions/:id/actions` acts once per suggestion:
  - skip and already attempted store today's replacement in the same
    transaction; already attempted also records `user_marked` attempt
    history, so the problem is never suggested again;
  - start runs the practice-session start in the same transaction, through
    `startSessionInTransaction()`, extracted from `startPracticeSession()`
    without behavior change;
  - a problem new to Ankify starts initial learning, and one already in the
    deck is started by id, so the suggestion's metadata never overwrites the
    problem's similar questions or topics.
- `GET /api/suggestions` lists today's suggestions, with each started
  suggestion's session outcome derived on read.
- `POST /api/attempt-history` merges LeetCode reads with their coverage.
- Novelty is `no_prior_attempt_found` only when one LeetCode account's
  accepted and tried lists were both read to the end within 30 days;
  otherwise it is `unverified`.
- New rate-limit scope `suggestions` (60 per minute). Suggestions are included
  in the account export.

Tests:

- DB:
  - daily idempotency and freezing, a new day;
  - extras, replays, request conflicts, nothing stored when none is eligible;
  - the daily cap;
  - every exclusion through real writes: captured, `leetcode_status`,
    deleted, and paid problems;
  - novelty freshness and both-scopes rules;
  - a personalized, targeted suggestion from real sessions and confirmed
    mistakes;
  - skip with its replacement, replay, conflict, and already-handled;
  - already attempted excluding the problem permanently;
  - start: initial learning, problem creation, replay, and the outcome after
    finishing through the normal rules;
  - start by id for an existing problem, keeping its metadata;
  - user isolation and the export.
- Concurrency, one race per file: racing daily requests give one daily
  suggestion; racing extras give distinct slots and targets.
- Routes: authentication, validation, the kill switch, and status mapping.
- Migrations: suggestions cascade with the user; upgrading creates none.
- Mutation checks, each failing a test:
  - dropping the by-id start;
  - dropping the replacement;
  - dropping the `user_marked` history;
  - dropping daily idempotency;
  - requiring only one coverage scope.

Rollback: `ANKIFY_DISABLED_WORKFLOWS=suggestions`. Stored suggestions, attempt
history, and practice sessions started from suggestions stay.

Until 5.4 replaces it, the popup shows its existing placeholder ("Daily
suggestions will appear here") now that the workflow is advertised.

## Checkpoint 5.4: suggestions in the extension

Status: **PASS**. **Phase 5 gate: PASS with the recorded exceptions below.**
No schema change.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 481 tests in 76 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 19 tests (one new suggestions test) |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

Changes:

- The popup's placeholder became today's suggestions.
  - `background/suggestions.ts` lists them and asks for the day's suggestion
    when today has none.
  - Each suggestion shows its explanation and novelty label, with Start
    practice, Skip, Already attempted, and Another suggestion.
  - A started suggestion shows "In progress", then its outcome.
  - Strings in English and Chinese.
- `suggestion_start` works like opening a due review: an open tab of the
  problem uses its own token; otherwise a token minted now is bound to the new
  tab.
- `set_baseline` optionally carries the page's LeetCode metadata. The page
  sends it with the baseline of a session started elsewhere, and the server
  refreshes the problem in the command transaction when the slug matches.
  This fills in a problem created from a suggestion's stored metadata, and
  records its similar questions as new candidates. The schedule is untouched.

Tests:

- The client asks for the day's suggestion only when missing, reports
  exhaustion, and maps errors.
- The page sends metadata with the baseline.
- `set_baseline` refreshes metadata, ignores another slug, and leaves the
  schedule untouched.
- Timezone rollover of the daily suggestion.
- Skip and already attempted change no problem row, FSRS field, review event,
  or profile.
- Browser: daily suggestion, skip with its replacement, another, already
  attempted, then start practice from the popup (initial learning in the
  opened tab), Accepted, Finish, and the outcome shown in the popup.

Phase 5 acceptance:

- One stable daily suggestion per local day, frozen across refreshes.
- Distinct extras.
- No known attempted target: problem rows, archived ones, deleted slugs,
  LeetCode status reads, and already attempted are all excluded.
- Truthful labels:
  - explanations state only stored metadata;
  - novelty is "Not checked against your LeetCode history" unless both
    LeetCode lists were read to the end.

Recorded exceptions:

- **The cold-start catalog is empty** until `scripts/leetcode-catalog.js` is
  run by the owner (5.1).
- **No LeetCode history reads yet.** Per-candidate status checks and the
  bounded problem-list sync are deferred until the live probe validates
  `question.status` and `questionList` status filters. The extension cannot
  query LeetCode outside a leetcode.com page without the `cookies`
  permission, which the plan rules out. Until then every suggestion's novelty
  is `unverified`, which the plan allows. `POST /api/attempt-history` and the
  coverage model are ready for it.
- If the page cannot read LeetCode when the baseline is set, a problem started
  from a suggestion keeps the suggestion's metadata (title, difficulty,
  topics) until a later capture.
- The Phase 3 **live LeetCode validation is still pending.**

Rollback: `ANKIFY_DISABLED_WORKFLOWS=suggestions` hides the popup section.
`set_baseline` without `problem` behaves exactly as before.

## Checkpoint 6A.1: settings for the extension-first workflow

Status: **PASS**. No schema or API change: the settings route already
accepted these fields.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 481 tests in 76 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 21 tests (two new web settings tests) |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

- Review schedule gains "First review after (hours)" (1 to 168), the
  initial-review delay of Phase 2.
- A new "Session analysis" section.
  - It states that analysis uses only the user's own key.
  - It offers the automatic-analysis toggle and daily limit (0 to 5) only
    when:
    - the deployment enables automatic analysis;
    - analysis is not switched off;
    - the user has a complete own configuration.
  - Otherwise it explains which of those is missing.
- Settings sections now carry an accessible name (`aria-label`).
- English and Chinese strings.

Browser tests:

- save and reload the first-review delay;
- the no-key explanation;
- with a key, enable automatic analysis with a limit, checked through
  `GET /api/settings`;
- the page in Chinese.

The local `next dev` server once took over ten minutes to compile
`/settings` after an edit (seen as one hung run). The same test passed in
3 to 5 s on rerun and in the gate.

## Checkpoint 6A.2: suggestions on the web

Status: **PASS**. No schema change.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 482 tests in 76 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 22 tests |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

- `/suggestions` (new nav item) shows today's suggestions: the same persisted
  items as the popup, with the same explanations and novelty labels.
  - The day's suggestion is allocated on the page's first view (idempotent
    per local day).
  - The page offers Open on LeetCode, Skip, Already attempted, and Another
    suggestion.
  - Starting practice happens from the extension panel on the problem page.
  - Loading skeleton; English and Chinese strings.
- Any new practice session on a problem with a pending suggestion marks it
  started and links the session, in the start's transaction. So a suggestion
  opened from the web and started on the problem page is associated like one
  started from the popup. The popup's start now tolerates the row being
  linked already.

Tests:

- DB: a session started from the problem page links the pending suggestion,
  which can then no longer be skipped.
- Browser:
  - the page adds another suggestion;
  - it links to the target on LeetCode;
  - skip and already attempted act on the same items the API and popup see;
  - the page in Chinese.

## Checkpoint 6A.3: mistake profile on the web

Status: **PASS**. No schema or API change.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 482 tests in 76 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 24 tests |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

`/analysis` opens with the mistake profile (`GET /api/mistakes/profile`
data), followed by the FSRS dashboard:

- A readiness notice until the profile is personalized.
- **Recorded mistakes** (confirmed only). Per category:
  - "Recurring" (weak and confirmed across problems) or "Needs more
    evidence";
  - sessions across problems;
  - unresolved, resolved, and improvements;
  - a trend against the previous period;
  - example links to the problem pages where records are resolved.
- **Suggested by session analysis**: unconfirmed AI findings, kept apart,
  with Confirm and Dismiss (`PATCH /api/mistakes/:id`).
- **Practice signals**: session outcomes, rating counts, the top ten topics
  (sessions, Accepted, first try, median failures before Accepted), and an
  incomplete-evidence note.
- Each tier is a named region. English and Chinese strings.

Deferred from the older PR2 dashboard spec:

- the period, topic, and source filters, which the profile API does not take;
- the quiz-accuracy tier, since quizzes are suspended in 6B.

Improvements are confirmed per session, with the session history (6A.5).

Found and fixed while gating: the QA AI worker (`apps/web/scripts/qa-worker.ts`,
used by `pnpm dev:qa` and the browser harness) exited on the first
`SQLITE_BUSY` from its poll query. It shares the local SQLite file with the
dev server, so every AI job later in the run stayed queued. It now logs the
error and keeps polling.

Browser tests:

- A session analyzed with the user's own key shows its findings under
  suggestions, and not under recorded mistakes.
- Confirming one moves it to recorded mistakes under its category.
- The page reads in Chinese.

## Checkpoint 6A.4: the dashboard

Status: **PASS**. No schema or API change.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 483 tests in 77 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 25 tests |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

`/today` is now the dashboard of the extension-first workflow
(`server/dashboard.ts`, user-scoped):

- The hero shows due problems from the same review overview the popup uses.
  Its action opens the next due review on LeetCode, or the suggestions page
  when nothing is due, instead of the legacy `/review` page.
- Today's counts: reviews, first practices, overdue, and the next seven days.
- Notices for finished reviews awaiting a rating, and for open sessions.
- The due list, linking each problem's page and its LeetCode page.
- Recent practice: the last eight sessions with kind and result, and the last
  week's completed sessions by outcome.
- Focus areas: the top weak, confirmed categories from the profile (or why
  there are none), today's pending suggestions, and links to `/analysis` and
  `/suggestions`.
- English and Chinese strings.

`server/today.ts` (the legacy queue loader, card counts included) was used
only by the old page and is removed.

Tests:

- DB: last week's completed sessions by outcome (an older session and an
  abandoned one excluded from the counts), recent practice newest first with
  titles, and user isolation.
- Browser: a finished session appears under recent practice as Accepted with
  the weekly line; the focus area links the profile; the page in Chinese.

## Checkpoint 6A.5: problem history

Status: **PASS**. **Phase 6A gate: PASS** (6A.1 to 6A.5). No schema or API
change.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 484 tests in 78 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 26 tests |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

`/problems/[id]` (History) gains:

- **Sessions tab:** each practice session with its kind, result, start time,
  submissions and Accepted count, active minutes, and its rating when one was
  given.
  - Skills confirmed as handled well are shown per session.
  - A completed session offers "Handled well" (`POST
    /api/mistakes/improvements`), the user-facing path to the improvement
    evidence of 4A.
- **History tab** becomes the scheduling timeline: ratings that were not
  undone, and initial-review schedules. Each entry shows its method (LeetCode
  solve or legacy self-recall), the next review date it set, and the FSRS
  snapshot.
- The rail shows the next review date.
- English and Chinese strings.

Found and fixed while testing and gating:

- **Stale improvement choice.** After a confirmation, the improvement
  control kept the confirmed skill as its selected value, though that skill
  was no longer offered, so it could be submitted again. The selection is now
  derived from the remaining skills.
- **Midnight flake in a Phase 2 test.** "counts session ratings, not initial
  learning, toward today's reviews" anchored on `now - 30 min` and failed
  within 30 minutes after midnight UTC. It now stays within the current UTC
  day.
- **Fixture id cascade in the browser harness.** One transient
  `SQLITE_BUSY` in the dev server failed one test. Playwright restarted its
  worker, which reloaded `tests/e2e/helpers.ts` and reset the fixture
  problems' LeetCode ids. "New" problems then resolved by id to existing
  ones and started as voluntary practice, failing thirteen tests. Fixture ids
  now start at a per-load offset.
- **The underlying lock flake.** The QA database used SQLite's rollback
  journal with a 0 ms busy timeout. Reads from one process (the QA worker
  polls every 250 ms) could make the other process's commits fail at once
  with `SQLITE_BUSY`, which surfaced repeatedly just after midnight UTC.
  `migrate.ts` now sets `journal_mode = WAL` on local file databases (local
  and QA; the mode persists in the file; Turso is untouched), so readers and
  writers no longer block each other. The rerun logged no lock errors.
  `*.db-wal` and `*.db-shm` are gitignored.

Tests:

- DB:
  - the timeline holds the initial schedule and a kept rating with its next
    due date, and excludes an undone rating;
  - sessions newest first, with per-session improvements;
  - user isolation.
- Mutation check: including undone ratings fails the test.
- Browser: a finished session's problem page lists it in Sessions; "Handled
  well" records a skill; History shows the first-review schedule with its
  date.

Phase 6A acceptance: Dashboard (`/today`), History (`/problems/[id]`),
Mistake Profile (`/analysis`), Suggestions (`/suggestions`), and Settings work
on the same backend items as the extension. Browser tests cover each surface
in English, and every surface except History in Chinese.

Deferred from 6A: profile filters and the quiz-accuracy tier (6A.3).

## Checkpoint 6B.1: legacy AI workflows suspended on the server

Status: **PASS**. No schema change.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 491 tests in 79 files |
| `pnpm typecheck`, `pnpm lint` (seven warnings), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 26 tests |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

- `coach`, `card_generation`, `quiz_generation`, and `credit_checkout` are
  off by default. Capabilities no longer advertise them, and their
  deprecations (`workflow_suspended`) are listed.
- Their routes answer `410` with the structured deprecation before any work:
  - `POST /api/ai-jobs` for card and quiz actions (replays by request id
    still return their job);
  - Study Coach turns;
  - proposal approvals;
  - credit checkout.
- `startAiJobForUser()` refuses them too.
- The runner fails a card or quiz job that was queued before the suspension,
  before any provider call. The failure refunds its hosted credit exactly
  once, even on redelivery.
- The Stripe webhook, balances, the ledger, and refunds are unchanged.
- An operator can re-enable one deliberately with
  `ANKIFY_ENABLED_LEGACY_WORKFLOWS` (no rollback does). The kill switch
  still wins.
- The existing card/quiz accounting and checkout suites opt in the same way,
  so the still-present code stays tested until it is removed.

Tests:

- Routes and provider spies: card and quiz generation, Coach turns, and stale
  proposal approvals answer `410` without starting a job, a Coach run, or any
  store access.
- Checkout answers `410` before Stripe.
- A queued card job fails with `workflow_suspended`, with no provider call
  and one refund across two deliveries.
- Capabilities: the default lists, the explicit re-enable, and the kill
  switch overriding it.
- Mutation check: dropping the runner guard fails the queued-job test.

Rollback: an operator may re-enable a workflow explicitly. The web pages that
still call these routes are retired in 6B.2.

## Checkpoint 6B.2: legacy web UI retired

Status: **PASS**. **Phase 6 gate: PASS** (6A and 6B). No schema change.

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 490 tests in 78 files |
| `pnpm typecheck`, `pnpm lint` (five warnings; the cap is lowered to 5), `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 28 tests (two new) |
| `pnpm extension:check-manifest` | PASS: 0.3.0 |

- **Study Coach.** The authenticated layout no longer mounts the Coach shell,
  and problem pages no longer report page context to it.
- **`/review`.** The workspace (quiz and card panels, shortcuts, the
  flexlayout workspace) is removed. `/review` redirects to
  `/today?retired=review`, which explains that reviews happen on LeetCode.
  Nav: no Review link; the due badge moved to Today; five links again, which
  also fits the mobile grid.
- **Problem pages.** No Cards tab or card controls. The primary action is
  "Practice on LeetCode", and the loader no longer reads cards.
- **Onboarding** describes the extension-first flow: the AI step is the
  optional own key for session analysis, the third step is the first
  practice, and the fourth is rating the first review. The starter-credit
  path and the `/review` button are gone.
- **Settings.**
  - Hosted-credit messaging appears only when an operator re-enabled a
    hosted-AI workflow.
  - Credit packs appear only when checkout is enabled; balances and purchase
    history still show.
  - The language and key-security help now describe session analysis.
- **The public landing page** describes the extension-first product. The
  hero is the still-accurate analysis capture, and text cards replace the
  quiz, Coach, and side-panel screenshots, whose captures were deleted.
- **Removed:** client code nothing imports any more. A reachability check
  from the Next.js entry points, tests, and scripts found these, and removed
  `flexlayout-react` and its stylesheet:
  - the Coach shell and sidebar;
  - the card list and the user-card button;
  - the mistake quick strip;
  - the agent event and AI-job client libraries.

Kept:

- the server code of the suspended workflows, guarded (6B.1), until the
  Phase 7 cleanup;
- `components/ui` primitives that are now unused (`tabs`,
  `indeterminate-progress`);
- two components that were already unused before this checkpoint
  (`LanguageToggle`, `ThemeToggle`).

The README still describes the old product and is updated in Phase 7, as the
plan schedules.

`legacy_review` stays an operator switch: its rate and undo routes now serve
only 0.2.x extensions, and DEPLOYMENT sequences that cutover after the 0.3.0
publish.

Tests (browser):

- `/review` lands on the dashboard with the notice;
- the nav has no Review link and no Coach control;
- problem pages have no Cards tab, and "Practice on LeetCode" links the
  problem;
- the signed-out landing page shows the new copy and none of the retired
  claims.

Phase 6 acceptance:

- Active navigation matches the new product.
- No card, quiz, or Coach generation path and no credit sale remains active:
  6B.1 guards the server, and 6B.2 removes the UI.

## Phase 7: documentation and owner-review fixes

Phase 7 is in progress. Its commits so far, after owner review of a local
build:

- `890de4e`: the panel is findable.
  - The popup has a "This problem" section: open the panel, or reload a tab
    that predates the extension.
  - Due problems open the panel automatically, and the pill reads "New
    problem" for an untracked problem.
  - The gear icon opens settings.
- `b2830a6`: README, SELF_HOSTING, and CLAUDE.md/AGENTS.md describe the
  extension-first product.
- `a07ce70`:
  - DeepSeek analysis no longer fails with `ai_request_rejected`: its
    JSON-object mode needs the schema in the prompt.
  - The time zone follows the device (web `TimeZoneSync`, extension
    overview).
  - Generation language defaults to English.
  - Problem-page actions are stacked.
- **Google Gemini provider:**
  - `google` is added to the provider enums. Drizzle text enums carry no CHECK
    constraint, so `db:generate` reports no migration.
  - `buildModel` uses `@ai-sdk/google`, pinned to `4.0.50`: the newest
    release on the `@ai-sdk/provider` spec that `ai@7.0.58` uses, since later
    ones fail typecheck.
  - Model listing reads `v1beta/models` and keeps `generateContent` Gemini
    models. Gemini's 400 for a bad key reports as `invalid_api_key`.
  - Gemini counts thinking against `maxOutputTokens`. `providerCallOptions()`
    sets thinking low (a level for Gemini 3, a budget for 2.5) and adds 4,000
    tokens of headroom for analysis.
  - Settings and onboarding offer Gemini presets.
- **Settings:** the time-zone row and its strings are removed, because the
  device decides the zone. The section is now "Language".

Gate for the Gemini/time-zone commit:

- `pnpm test`: 494 tests.
- `pnpm typecheck`, `pnpm lint` (5 warnings), build, manifest: all passed.
- `pnpm test:e2e`: 28 tests.
  - The first run, right after the dependency change, had 6 timeouts in
    submission-tracking specs and a dev-server "destination stream closed
    early".
  - An unchanged re-run passed all 28 in 1.9 minutes.

Still open in Phase 7:

- dead-code cleanup (unused i18n `agent`/`quiz` groups, `LanguageToggle`,
  `ThemeToggle`);
- the live LeetCode probe report;
- a real-provider analysis run with Gemini.

## Next phase: post-refactor QA fixes (`docs/NEXT_PHASE_PLAN.md`)

### 1a: live submission tracking and popup/panel sync

Root causes, from the code:

- **"No submissions yet" until Finish.**
  - The page polled LeetCode only while the tab was visible *and focused*; LeetCode's result view often takes focus. Finish forced a poll, which is why the submission appeared then.
  - Submissions still being judged were skipped silently.
  - A report saved in the outbox (not yet delivered) never updated the panel.
  - Also: a report the worker never received (it was restarting) was not retried, because the page treated "offline" as handed off.
- **A popup rating left the panel on its rating screen.** The worker never told other surfaces about changes. The content script only handled `open_panel`, and the popup had no listener.

Changes:

- **Polling.** The page polls while visible; focus still decides active time. A Submit click (LeetCode's `console-submit-button`, or a Submit/提交 label) or Ctrl/Cmd+Enter starts a 2 s watch for up to 45 s. A submission still being judged extends the watch. The watch ends once the verdict is reported.
- **Panel display.** The panel shows "N being judged", "N saved here, waiting to sync", and unplaced (ambiguous) submissions. Page state now carries `localSync.pendingObservations` from the outbox, which clears the "waiting" line once delivered. A hand-off the worker did not take is reported again.
- **Sync.** After a session-changing message or an outbox delivery, the worker sends `session_changed`: to the popup over the runtime, and to LeetCode problem tabs except the sender. Both re-read the server, with sequence guards against out-of-order reads. A panel busy with an action re-reads after it. `expand()` also re-reads.
- **E2E fixture.** The LeetCode fixture's submission ids restarted at 20000 whenever Playwright reloaded its worker after a failure. They then collided with ids already stored for the QA user, so every later tracking spec failed. This was the cause of the "6 timeouts" flake recorded for `c68769d`. Ids are now time-based. The import spec clicked the pill of a panel that auto-opens for a due problem, closing it; it now uses `openPanel`.

Gate:

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 503 tests |
| `pnpm typecheck`, `pnpm lint` (5 warnings), build, manifest | PASS |
| `pnpm test:e2e` | PASS: 30 tests in one run, including the new live-count and popup/panel rating specs |

### 1b: mandatory rating and Finish freeze

Findings:

- **"Rate later" came back.** A deferred rating was still returned as `pendingRating` by the page and overview reads, so the panel's local dismissal did not last.
- **Expiry already existed.** The 24-hour expiry was already implemented: `effectiveRatingDisposition` reports `expired` on read, and expired ratings never touch FSRS. No new lifecycle state or migration was needed.
- **No late submissions reached a finished session.** The extension stops tracking at Finish, and only the observation route writes session submissions.

Changes:

- **"Rate later" is retired.**
  - The panel and popup buttons are gone. The `session_rating_decision` message only skips.
  - The server answers `defer_rating` (from an older extension's outbox) with `rating_defer_retired`.
  - Legacy `deferred` rows still read as pending and can be rated or skipped.
- **Rate or skip first.** A due or early review does not start while another problem's finished review awaits its rating. The 409 `rating_pending` names that session and its problem, and the panel offers that rating inline with Skip. Practice is never blocked. The UI no longer offers "Start anyway" / "Start new review"; same-problem supersede stays API-only.
- **Duplicate ratings.** A rating that finds `rating_not_pending` (rated elsewhere first) refreshes both surfaces instead of showing an error. The server's existing guards keep it to one FSRS update.
- **Finish freeze, by submission id.** After Finish the page reports only verdicts of submissions LeetCode was still judging at Finish, for up to 60 s. Nothing made after Finish is reported.
  - **Deviation from the plan:** `END_GRACE_MS` stays at 60 s instead of shrinking to 5 s. Finish carries the device's clock while submissions carry LeetCode's, so a tight server window would drop real late verdicts on a slow device clock.

Gate:

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 508 tests |
| `pnpm typecheck`, `pnpm lint` (5 warnings), build, manifest | PASS |
| `pnpm test:e2e` | PASS: 31 tests. The deferred-rating spec is replaced by "rating survives closing the page, rated in the popup"; a new spec covers rate-or-skip before another review |

### 1c: sign-in and connection errors, offline verification

Findings:

- **"Can't reach ankify" covered unrelated failures.**
  - It was shown when the content script's `sendMessage` threw (worker restarting, or the extension reloaded so the script was orphaned).
  - `import_history` reported a LeetCode read failure as `offline`.
  - The router mapped every non-auth failure of import, capabilities, and notes to `offline`.
  - The live "Review early after re-signing in to LeetCode" report could not be reproduced against the fixture. The scripted flow (sign out mid-session, sign back in, rate, Review early) works. The likeliest live cause is an orphaned script or a worker that missed its first message, both now reported and retried distinctly. The owner still needs to check this live (TEST_GUIDE §1.6).
- **Offline sync waited out its backoff.** Reconnecting did not sync at once: queued work waited its backoff, and the retry alarm runs no sooner than 30 s.
- **DevTools' Offline on a LeetCode tab does not cut ankify sync.** All ankify traffic runs in the service worker.

Changes:

- **Content `send`.** It retries once after 300 ms. An orphaned script reports `extension_reloaded`, which the panel shows as "Reload page", and stops tracking. A worker that never answers reports `extension_unavailable`. The popup bridge retries the same way.
- **Router errors.** Failures map through `apiFailure()`: `signed_out`, `offline`, `server_error`, `rate_limited`, or the server's code. LeetCode read failures in import are `leetcode_signed_out` or `leetcode_unavailable`.
- **Panel states.**
  - A failed heartbeat shows "Can't reach ankify right now. Submissions are saved here…" until one lands.
  - An expired ankify session shows the sign-in view. The sign-in and offline views re-read when the tab is shown again.
- **Immediate resync.** Any successful page read, heartbeat, or popup open makes waiting outbox work due now and flushes it. Deliveries made that way nudge the popup and tabs.
- **Tests.**
  - e2e: LeetCode sign-out and sign-in mid-session, then Review early; an outage before start; an outage during a session and while rating, including immediate sync.
  - Unit: error mapping, reload and outage handling, and resync.
  - TEST_GUIDE §1.7 explains which execution context to cut.

Gate:

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 513 tests |
| `pnpm typecheck`, `pnpm lint` (5 warnings), build, manifest | PASS |
| `pnpm test:e2e` | PASS: 34 tests |

**Phase 1 passes.** It is verified against the LeetCode fixture and mocks only. The owner must still check these live:

- the LeetCode Submit button locator;
- sign-out and sign-in;
- reloading the extension.

### 2: remove and simplify

- **Editor reset removed.** `content/reset-code.ts`, its panel button, and its strings are gone; no shared helper depended on them. LeetCode's own reset remains.
- **"Skill handled well" retired.**
  - The UI, the `/api/mistakes/improvements` routes, `createImprovement` and related functions, the contract schema and DTO, and the `improvement_test` automatic-analysis trigger are all removed.
  - `practice_improvements` rows stay in the database and the account export, but count for nothing. No migration.
  - The profile now derives *clean reviews* in `computeMistakeProfile()`: a later accepted session (not rated Again) on a problem with a confirmed mistake of that dimension, with no record of it this time. They use the old weight and decay. The DTO field `improvements` became `cleanReviews`, and the detail line reads "N clean reviews since". This was the owner's decision of 2026-10-01.
- **`/problems` columns renamed:** Problem, Difficulty, Next review, Reviews (`fsrsReps`), Times forgotten (`fsrsLapses`, now its own sortable column), Memory state, with hover explanations.
  - The legacy "Drills" column (ready card count) and its query are removed.
  - The sort indicator is an SVG chevron instead of a ▲/▼ glyph, per the UI conventions.
- **Problem page layout.** The workspace lost `h-[42rem] max-h-[calc(100vh-3rem)] overflow-hidden` and the inner `overflow-y-auto`. Panels grow and the page scrolls. The tab bar is not sticky, because the app nav already is.
- **Tests.**
  - e2e at 1920, 1280, and 390 widths: no nested scroll container around the statement, the page scrolls, and nothing overflows horizontally.
  - e2e: the table header names.
  - `web.spec.ts` submission ids are now time-based, the same worker-reload fix as 1a.

Gate:

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 508 tests |
| `pnpm typecheck`, `pnpm lint` (5 warnings), build, manifest | PASS |
| `pnpm test:e2e` | PASS: 36 tests |

### 3: AI-first mistakes

- **Problem page.**
  - The Sessions tab shows each completed session's analysis: queued or analyzing with a spinner, the result, failed with its reason, or unavailable (needs own key, no code). It loads when it first scrolls into view and polls while a job runs.
  - Findings offer confirm, correct (category menu), and dismiss, plus Analyze, Analyze again, and Retry.
  - The Mistakes tab lists open suggestions first. Confirmed records are labeled "From analysis" or "Recorded by you", with "Corrected from X".
  - Manual entry is a plain "Add a mistake manually" link. The per-submission "Log mistake" button (and `log-mistake-button.tsx`) is removed.
- **Shared `CandidateActions`.** One component in `components/mistakes/` serves `/analysis` and the problem page, and now offers category correction on the web; before, only the extension could correct.
- **Corrections.** Confirm-with-category is one PATCH. `MistakeRecordDto.suggestedCategory` comes from the candidate's request id (`analysis:<id>:<category>`), so no migration is needed. The profile counts only the final category.
- **Integrity.**
  - A newer analysis deletes the session's earlier *open* AI candidates in its commit transaction. Confirmed and dismissed ones stay, and a confirmed category is never re-suggested.
  - `toAnalysisResult()` drops findings that cite no attempt, and every finding when the model reports `insufficientEvidence`.
  - The existing prompt already forbids treating a verdict as a cause.
- **Tests.**
  - Unit: the uncited and insufficient guards; re-analysis replacing open candidates without duplicating a confirmed one; correction keeping `suggestedCategory` and counting only the new category.
  - e2e: analyze from the web Sessions tab, correct, confirm and dismiss, then the Mistakes tab labels and the manual link.

Gate:

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 509 tests |
| `pnpm typecheck`, `pnpm lint` (5 warnings), build, manifest | PASS |
| `pnpm test:e2e` | PASS: 37 tests |

### 4: automatic analysis that works in development; real providers

Why automatic analysis was tied to the cron:

- A job commits with the finished session, and the queue send happens after the commit and can fail.
- A manual job is recovered by the user's own polling; an automatic one had nobody polling, so it was gated behind `ANKIFY_AUTOMATIC_ANALYSIS=enabled` until a cron existed.
- Locally, the QA worker reads the database directly and dispatch is a no-op, so only the flag blocked it.

Changes (the owner's decisions of 2026-10-01: on by default with the user's own key, no daily limit):

- **Deployment flag.** `ANKIFY_AUTOMATIC_ANALYSIS` is now a kill switch: automatic analysis is on unless it is `disabled`. Recovery is request-time (the popup, problem pages, analysis reads), with the cron as an optional backstop. DEPLOYMENT.md asks the owner to decide before deploying to Production.
- **User setting.** `analysis.automatic` defaults to true. `dailyAutomaticLimit` is removed from contracts, the API, the UI, and planning, and a stored value is ignored. The manual limit (10 a day) stays.
- **Eligibility.** A completed session with any failed submission that has code qualifies. The reason is recorded as `repeated_failures`, `pattern_recurrence`, or `failed_attempt`. A clean Accepted, an unfinished session, or a failure without code never qualifies.
- **Planning.** There is one job per session and evidence digest (`auto:<session>:<digest>`). A job starts about 15 s after Finish (`runAfter`), so late verdicts are read; the runner always reads the evidence current at run time. The panel shows "Analysis queued …" right away.
- **Errors.**
  - 401/403, or an auth failure without a status (`LoadAPIKeyError`, "invalid api key"), fails at once as `ai_request_rejected`.
  - A 429 for an empty account (`insufficient_quota` or `credit_balance`) fails at once as `ai_quota_exceeded`, with its own message in the web and extension.
  - Other 429 and 5xx responses retry, never sooner than `Retry-After`.
- **`pnpm qa:provider-smoke`.** For each `SMOKE_<PROVIDER>_API_KEY` in the git-ignored `.env.smoke.local`, it runs one fixture session through the real job pipeline on a throwaway database, then checks an invalid key. It prints provider, model, outcome, and timing only, with logging silenced.

Real-provider results (2026-10-01), all on the owner's keys:

| Provider | Model | Result |
| --- | --- | --- |
| DeepSeek | `deepseek-v4-flash` | PASS: 2 findings |
| Anthropic | `claude-haiku-4-5-20251001` | PASS: 1 finding |
| Google | `gemini-3.5-flash` | PASS: 1 finding, about 35 s |
| OpenAI | `gpt-4o-mini` | BLOCKED: the account has no credit (`insufficient_quota`) |

- The OpenAI run found the quota misclassification, now fixed: the first run retried it 3 times.
- The invalid-key check passed for all four providers.

Gate:

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 509 tests |
| `pnpm typecheck`, `pnpm lint` (5 warnings), build, manifest | PASS |
| `pnpm test:e2e` | PASS: 37 tests |

### 5: testable suggestions

Findings:

- **No background process.** Suggestions need no scheduled import or background process. Candidates are similar questions recorded when a problem is captured or started from its LeetCode page, plus the committed catalog.
- **Empty pools.** The catalog is empty because `scripts/leetcode-catalog.js` was never run. The QA and demo seeds wrote only `similarSlugs` (no `suggestion_candidates`), so every QA account showed "No new problem to suggest yet".
- **Personalization.** Personalized picks also need a personalized profile and a weak, ready dimension, which the seed did not have.

Changes:

- **Seed fixture.** `apps/web/scripts/suggestion-fixture.ts`, called by `qa:seed`, gives the main QA account:
  - 3 completed voluntary-practice sessions on its 3 problems, each with a confirmed edge-case mistake, plus one implementation mistake;
  - similar-question candidates: five eligible, plus one paid-only, one already accepted (`attempt_history`), and one already in the deck.
  - The second QA account stays empty.
  - The seeded sessions are voluntary practice, so no schedule or rating changes. The demo seed is unchanged.
- **Server test.** `server/suggestions/qa-fixture.test.ts` checks against the fixture:
  - the profile is personalized, with edge cases weak and ready;
  - the day's suggestion is personalized (edge cases, "similar to");
  - extras yield exactly the five eligible problems, then `no_candidates`;
  - "already attempted" records history;
  - the second account gets nothing.
- **E2E.** `suggestions.spec.ts` acts on whatever is suggested: skip, another, already attempted, start practice through to Solved. It checks that excluded slugs never appear, and adds the second account's empty state. The old spec assumed that every candidate came from its own captured problem.
- **No QA catalog file.** This deviates from the plan: the fixture covers basic and personalized behavior without one, and the real catalog stays an owner task, documented in TEST_GUIDE §3.

Gate:

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 513 tests |
| `pnpm typecheck`, `pnpm lint` (5 warnings), build, manifest | PASS |
| `pnpm test:e2e` | PASS: 38 tests |

### 6: LeetCode-native visual refresh

- **Palette.** One palette lives in `apps/extension/src/shared/theme-tokens.ts`.
  - It uses LeetCode's dark and light surfaces (`#1a1a1a` / `#262626`; `#f7f8fa` / `#ffffff`) and LeetCode orange `#ffa116` as `accent-solid`, for fills, borders, rings, and focus.
  - Text uses a text-safe `accent`: `#ffa116` in dark, `#a85800` in light, because `#ffa116` on white is 2.0:1.
  - Every text color was checked at 4.5:1 or better on its surface.
  - The panel builds its CSS from the module. The popup's four blocks and the web's three repeat it, and `theme-tokens.test.ts` fails on any drift.
- **Web.**
  - The `accent-solid` Tailwind color replaces accent fills, borders, and rings: 33 usages.
  - The card shadow is flattened. Problem-table headers are sentence case.
  - The logo mark is LeetCode orange in both themes.
  - CLAUDE.md and AGENTS.md list the new token.
- **Panel.**
  - It follows LeetCode's own theme: the root's `dark`/`light` class, `data-theme`, or `color-scheme`, watched with a MutationObserver and mirrored to `data-theme` on the shadow host. With no signal it falls back to the system preference.
  - Radii are 8 px. Rating buttons have a grade-colored leading edge, and their labels still name the grade.
  - The card is capped to the window height, with a scrolling body.
  - Styles stay inside the shadow root.
- **Popup.** Same tokens, 8 px radii, the same grade-edged rating buttons.
- **Hydration fix.** Found by the gate: `/problems` decided "due" from the server's clock snapshot but formatted with `Date.now()`, so a due time near a minute boundary rendered "now" on the server and "1m ago" on the client. `formatRelative()` now takes `now`, and the table passes the snapshot. A regression test covers it.
- **Visual suite.** `pnpm test:visual` (`playwright.visual.config.ts`, `tests/visual/`, own fresh QA server) runs screenshot regression over:
  - the panel: collapsed, due, active, rating, and rated, in LeetCode light and dark;
  - the popup with data and empty, in both themes;
  - six web pages at 1440×900 in both themes;
  - three pages at 390×844, which also assert no horizontal scroll.
  - Day-dependent text is masked, and the Next.js dev overlay (which counts React's dev-only "eval" CSP warning) is hidden.
  - Every baseline was reviewed by eye before acceptance, and two fresh runs matched.
- **Still open (owner):** confirm the theme signal and the panel's position on live leetcode.com.

Gate:

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 517 tests |
| `pnpm typecheck`, `pnpm lint` (5 warnings), build, manifest | PASS |
| `pnpm test:e2e` | PASS: 38 tests |
| `pnpm test:visual` | PASS: 7 tests, 29 screenshots |

### 7–8: functional QA and visual/accessibility QA

**Functional (brief 3):**

- **Coverage.** The coverage matrix was audited against the tests added in phases 1–5:
  - tracking, the rating lifecycle and exactly-once FSRS, cross-surface sync, auth and offline;
  - AI analysis: eligibility, correction, integrity, provider failures, recovery;
  - the profile, and suggestions.
- **New test.** One gap remained: an e2e test where automatic analysis completes after the LeetCode tab is closed and the result is found on the problem page.
- **Browser.** The real-browser pass uses Playwright's Chromium with the built extension on the fixture. Chrome DevTools MCP was not used, because it would drive the owner's own Chrome profile and accounts.
- **Bug found by the gate:** the `/problems` hydration mismatch fixed in 6.
- **Earlier phases.** Bugs found there and fixed with regression tests:
  - fixture ids reused after a Playwright worker reload (1a);
  - an unreported worker hand-off (1a);
  - the quota error being retried (4).

**Accessibility and visual (brief 4):**

- **axe.** `tests/e2e/a11y.spec.ts` (`@axe-core/playwright`, WCAG 2.1 A/AA) covers six web pages, the popup, and the panel (due and rating) in light and dark, plus keyboard focus visibility on the web, the popup, and the panel. Serious and critical violations fail.
- **Fixed:**
  - Color contrast of status pills: success and danger text on 10–15 % tints of the same color were under 4.5:1. Light success, danger, warning, easy, hard, and text-accent are darker; dark danger and hard are lighter. LeetCode green and orange are unchanged.
  - A focusable `role="separator"` (the problem-page column resizer) without `aria-valuenow`/`min`/`max`.
  - Inline links told apart by color only (the profile examples, legal pages, the settings link in the analysis box). They now have a subtle permanent underline.
- **Visual baselines** were regenerated after the contrast change and reviewed.

**Not automatable here (owner):**

- live leetcode.com: the theme signal, the panel position against the real editor and console, and the Submit-button locator;
- the extension popup at OS zoom levels;
- Windows font rendering.

Gate:

| Check | Result |
| --- | --- |
| `pnpm test` | PASS: 517 tests |
| `pnpm typecheck`, `pnpm lint` (5 warnings), build, manifest | PASS |
| `pnpm test:e2e` | PASS: 44 tests (incl. 5 a11y) |
| `pnpm test:visual` | PASS: 7 tests, 29 screenshots |

**The next phase (`docs/NEXT_PHASE_PLAN.md`) is complete.**
