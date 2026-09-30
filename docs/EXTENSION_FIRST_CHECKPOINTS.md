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
