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

The seven recorded web lint warnings are all
`@next/next/no-location-assign-relative-destination` (three in
`problems-client.tsx`, two in `review-client.tsx`, one in the settings form,
one in `nav.tsx`). `apps/web` lint runs with `--max-warnings=7`, so any new
warning fails the gate; lower the cap as those files change.

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

Status: **PASS** (live LeetCode exception from Phase 3 unchanged). Migration
`0022_m2_session_evidence` (additive, not yet applied to Preview or
Production).

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
