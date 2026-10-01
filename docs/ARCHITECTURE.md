# Architecture

Canonical description of how ankify is built. `CLAUDE.md` and `AGENTS.md` link
here instead of repeating it; update this file when the architecture changes.
Paid AI credits have their own deep-dive in [PAID_AI_CREDITS.md](PAID_AI_CREDITS.md).
Deployment and data-ownership rules live in [DEPLOYMENT.md](DEPLOYMENT.md) and
[SELF_HOSTING.md](SELF_HOSTING.md). Features in progress have their own plans:
[MISTAKE_PROFILE_PLAN.md](MISTAKE_PROFILE_PLAN.md) and
[DAILY_FEED_PLAN.md](DAILY_FEED_PLAN.md).

## Shape of the system

A modular monolith: one Next.js deployment (web app + API) on Vercel, a Chrome
MV3 extension, and a single database. pnpm workspaces:

| Package | Role |
| --- | --- |
| `apps/web` | Next.js 16 App Router: pages, API routes, Vercel Queue consumer, all server logic in `src/server/` |
| `apps/extension` | Chrome MV3 extension (content script, background worker, popup/side panel) |
| `packages/db` | Drizzle schema (`src/schema.ts`), migrations (`drizzle/`), `getDb()` client, env profile loading |
| `packages/core` | Browser-safe domain logic: FSRS wrapper (`fsrs.ts`), shared types, quiz Markdown formatter |
| `packages/contracts` | Zod request schemas and JSON-safe DTOs shared by web, extension, and DB JSON columns |
| `packages/api-client` | Isomorphic AI-job client (start, poll, cancel) used by web and extension; caller supplies `fetch` |

Boundaries: browser code never imports `@ankify/db`; public APIs return DTOs
from `@ankify/contracts`, never raw Drizzle rows; `apps/web/src/lib/` is
browser-safe helpers only; DB/auth/AI/queue code lives in `apps/web/src/server/`
and API routes stay thin HTTP adapters.

## Data and persistence

- **Database**: Turso (libSQL) in Preview/Production, a local SQLite file in
  development/QA. `getDb()` picks Turso when `TURSO_DATABASE_URL` is set and
  refuses local SQLite on Vercel. Every Drizzle transaction opens with
  `BEGIN IMMEDIATE` (libSQL's default `write` mode), so writers are serialized.
- **Profiles**: `ANKIFY_PROFILE` selects `local` (default), `qa`, `preview`, or
  `production` env files for CLI tools (`loadDbEnv()` in `packages/db/src/client.ts`).
  Production runtime reads Vercel env vars, not files.
- **Migrations**: edit `schema.ts`, run `pnpm db:generate`, commit the generated
  SQL + snapshot, apply with `pnpm db:migrate` (local) or the documented release
  flow (`pnpm db:release`, see DEPLOYMENT.md). Migrations are additive; apply
  them before deploying code that depends on them.
- **Isolation**: every business table carries `userId` and every query is scoped
  by it, including raw SQL. `problems.leetcodeSlug`/`leetcodeId` are unique per
  user. User deletion cascades to all user-owned rows except the credit ledger
  and purchase records, which are kept for accounting; deleting forfeits any
  purchased credits and requires the user's explicit acknowledgement.

Tables (all in `packages/db/src/schema.ts`):

| Table | Purpose |
| --- | --- |
| `user`, `session`, `account`, `verification` | Better Auth |
| `problems` | One LeetCode problem per user; holds the FSRS state (problem-level scheduling), notes, `archivedAt`, a monotonic `schedule_revision`, and `enrollment` (`awaiting_initial` until a session's initial learning completes) |
| `submissions` | Captured attempts incl. code and failing test details; a LeetCode submission id identifies an attempt |
| `practice_sessions`, `practice_session_submissions`, `practice_session_commands` | Tracked attempts on LeetCode, their submission observations, and command idempotency records (see Practice sessions) |
| `cards` | Q&A flashcards; `aiStatus` `candidate | failed | ready`; integer `version` for optimistic concurrency |
| `quiz_sessions` | 5-item quizzes (`active | completed | archived`), answers, score |
| `review_events` | Append-only history with FSRS snapshots; ratings are undone by stamping `undoneAt`; newer events record session, policy, method, and schedule-revision provenance |
| `mistake_records` | Causes of failure, confirmed by the user (or AI candidates awaiting confirmation), linked to a submission, quiz answer, rating, or practice session, with structured evidence references; partial unique indexes dedupe per source and category (see MISTAKE_PROFILE_PLAN.md) |
| `practice_improvements` | Retired "Skill handled well" confirmations. Kept for history and export; no longer written or counted (improvement is derived from clean reviews) |
| `ai_jobs` | Durable async card, quiz, and session-analysis commands (see below) |
| `session_analyses` | Immutable session-analysis results, cached per evidence version, analyzer version, provider, and model (see Session analysis) |
| `suggestion_candidates` | Verified LeetCode metadata (title, difficulty, paid flag, topics, source, `verified_at`) of problems that may be suggested |
| `attempt_history`, `attempt_history_coverage` | Attempted problems by slug and source, independent of `problems` rows, and how much of a LeetCode account's history was read (see New-problem suggestions) |
| `agent_sessions`, `agent_runs`, `agent_messages`, `agent_steps` | Persistent Study Coach conversations |
| `settings` | Per-user key/value: encrypted AI config, review/generation prefs, onboarding, rate-limit windows, starter-credit counter, Stripe customer ids |
| `ai_credit_balances`, `ai_credit_ledger`, `credit_purchases` | Hosted AI credits (see PAID_AI_CREDITS.md) |

## Authentication and authorization

- Better Auth with Google OAuth (`/api/auth/[...all]`). Signup is public;
  `ANKIFY_DISABLE_SIGNUP=true` pauses new accounts only.
- `src/proxy.ts` (Next 16 proxy convention) is only a cookie gate and the
  extension CORS preflight handler. Every server page calls `requirePageUser()`
  and every API route calls `getRequestUser()` (cookie-cached) or
  `getRequestSessionUser()` (fresh session; used for settings, account, billing).
- Public routes: `/`, `/login`, `/welcome`, `/privacy`, `/terms`, `/api/auth/*`,
  `/api/queues/*` (Vercel Queue callbacks), `/api/billing/webhook` (Stripe
  signature), and `/api/qa/login` in the QA profile only.
- The extension reuses the web session cookie (`credentials: include`); its API
  origin is fixed at build time (`ANKIFY_EXTENSION_API_ORIGIN`), and production
  CORS allows only `ANKIFY_EXTENSION_ORIGINS`.
- Production fails closed without `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  Google credentials, and `AI_KEY_ENCRYPTION_SECRET`;
  `scripts/check-vercel-env.mjs` validates Vercel env at build time.

## Review scheduling (FSRS)

- FSRS-6 via `ts-fsrs` in `packages/core/src/fsrs.ts`. Elapsed days are
  recomputed from `last_review`, never trusted from storage. Only the
  **problem** is scheduled. Every FSRS write advances `problems.schedule_revision`
  and records its policy on the review event:
  - `leetcode_full_solve_v1` (sessions): default weights, 90% retention, fuzz,
    short-term learning steps disabled, so every grade yields a day-based
    interval. A rating is computed as of the review's completion time, so a
    rating given hours later schedules from when the review happened.
  - `initial_delay_v1`: finishing initial learning schedules the first review
    `initialReviewDelayHours` (1-168, default 24) after completion; the state
    stays `new` and no rating is recorded (`fsrs_scheduled` event).
  - `legacy_self_recall_v1`: `POST /api/review/rate` (default FSRS with
    minute-scale learning steps), kept for old clients until cutover. It
    refuses problems still awaiting initial learning.
- `POST /api/practice-sessions/:id/rating` is the exactly-once session rating:
  a completed review (due, or explicitly early) whose rating is pending (or
  `deferred`, from the retired "Rate later") and whose problem schedule is
  unchanged since the session started. One rating event per session is
  enforced by a unique index; the response is stored for replay. Voluntary
  practice, capture, and dashboard visits never change the schedule.
- The rating is due right after Finish: rate, or skip (`dismiss_rating`).
  `defer_rating` answers `rating_defer_retired`. An unresolved rating
  expires 24 hours after completion (computed on read) without touching
  FSRS. A due or early review does not start while another problem's
  finished review awaits its rating (`rating_pending` names that session and
  problem).
- Undo (`undo_rating` session command, or `POST /api/review/undo`) restores the
  event's `metadata.undo` snapshot. It is allowed only while the event still
  accounts for the current revision: the revision must equal the event's plus
  two per later scheduling event that was itself undone (each such event and
  its Undo advanced it once). Any other change blocks it, even one that keeps
  the repetition count; successive Undo still works. An undone session can
  never be rated again. Events from before migration 0021 use the legacy
  repetition check.
- The due condition (`server/due-problems.ts`) excludes archived problems and
  problems awaiting initial learning; the daily limit and time zone come from
  per-user review settings. `GET /api/review/overview` returns due (most
  overdue first, within the daily limit), upcoming, pending ratings, open
  sessions, and today's counts, which keep reviews, initial learning, and
  completed sessions apart. Retrievability of a never-reviewed problem is
  "not yet estimated" (`retrievabilityEstimate()` returns `null`).

## Practice sessions

The extension-first workflow ([plan](EXTENSION_FIRST_REFACTOR_PLAN.md),
[checkpoints](EXTENSION_FIRST_CHECKPOINTS.md)) tracks each attempt at a problem
as a practice session. The server owns the lifecycle; the extension reports.
Pure rules live in `packages/core/src/practice-session.ts`, services in
`server/practice-sessions/`.

- **Kinds**: `initial_learning` (a problem new to Ankify, created
  `awaiting_initial` and kept out of the queue), `scheduled_review` (due, or
  explicitly started early), `voluntary_practice` (never changes the schedule).
- **Lifecycle**: `active` → `completed` | `abandoned`. An active session whose
  owner lease lapsed reads as `interrupted` (never a failure); after 24 hours
  without activity it is stale history and a new session is required. One
  open session per problem (partial unique index on `is_open`).
- **Ownership**: the controlling tab holds a 60 s lease renewed by heartbeats.
  Another tab takes over explicitly; afterwards the old tab can neither
  heartbeat, finish, nor rate. Without a live lease any tab may resume.
- **Observations**: submission verdicts are stored per session even without
  code details; details go through `storeSubmissions()` (capture's identity
  rules). LeetCode's submission time (and the baseline id seen at start)
  places each observation; historical submissions stay unassigned and
  boundary cases are kept as ambiguous rather than guessed. A LeetCode
  submission id belongs to at most one session per user.
- **Idempotency**: start and every non-heartbeat command carry a request id;
  a replay returns the stored response and a changed payload is `409`.
  Heartbeats report cumulative per-tab timing merged with `max()`.
- **Timing**: estimated foreground (`activeMs`) and tracked (`observedMs`)
  time are stored apart from wall time; completion times from the client are
  clamped into the session window and flagged when adjusted.
- **API**: `POST/GET /api/practice-sessions`, `GET /api/practice-sessions/current`,
  `GET /api/practice-sessions/:id`, `POST .../:id/commands`,
  `POST .../:id/submissions`. Tabs send `X-Ankify-Owner-Token` on reads.
- **Kill switch**: `ANKIFY_DISABLED_WORKFLOWS` (comma-separated workflow ids)
  disables a workflow's routes and removes it from `GET /api/capabilities`.

### Mistake evidence and profile

Details: [MISTAKE_PROFILE_PLAN.md](MISTAKE_PROFILE_PLAN.md).

- A mistake record belongs to a practice session when made on it, or when its
  submission or rating came from one (derived server-side). Evidence
  references (observations, submissions, code ranges, judge output) must
  belong to the same user and problem; they are facts, apart from the
  inferred summary.
- `GET /api/mistakes/profile` computes the profile on every read from
  user-scoped joins over the last 90 days (`server/mistake-profile.ts` loads,
  `computeMistakeProfile()` in `packages/core` aggregates). Each (session or
  legacy source, category) counts once, only confirmed records weigh, AI
  candidates are listed apart, and nothing derived is stored, so Undo,
  dismissal, and resolution take effect immediately.
- Accepted verdicts and Good/Easy ratings are topic success, not mastery of
  a dimension. A dimension's weakness is lowered by *clean reviews*, derived
  on read: a later completed, accepted session (not rated Again) on a problem
  with a confirmed mistake of that dimension, where the session has no
  record (confirmed or suggested) of it.

## AI configuration and hosted keys

`server/settings.ts:getAiRuntimeSettings()` decides which key an AI call uses:

1. The user's own provider/model/key (AES-256-GCM encrypted with
   `AI_KEY_ENCRYPTION_SECRET`; APIs expose only `hasApiKey`). Always wins and
   never spends credits (`source: "user"`).
2. Otherwise the server's hosted key when `ANKIFY_STARTER_AI_API_KEY` is set
   (`source: "starter"`). Work on this key spends hosted credits (card 1, quiz
   2, Study Coach turn 5): free starter credits if they cover the cost, else
   purchased credits (`server/ai-credits.ts`).
3. Otherwise a clear `AI_NOT_CONFIGURED` / `AI_KEY_MISSING` error.

Providers: Anthropic, OpenAI, Google Gemini (`@ai-sdk/google`), and
OpenAI-compatible presets (DeepSeek) built in `server/ai.ts`. DeepSeek thinking
can be disabled per call; Gemini counts thinking against the output cap, so
`providerCallOptions()` keeps its thinking low and adds headroom.

## Asynchronous AI generation (cards and quizzes)

> **Suspended (extension-first Phase 6B):** Study Coach, card and quiz
> generation, and credit sales are off by default. Their routes answer `410
> workflow_suspended` (`legacyWorkflowResponse()`), and capabilities list them
> as deprecations. Card and quiz jobs queued before the suspension fail in the
> runner before any provider call, which refunds their hosted credit once. The
> Stripe webhook and credit accounting keep working. An operator can re-enable
> one explicitly with `ANKIFY_ENABLED_LEGACY_WORKFLOWS`; no rollback does.

Card and quiz generation never run inside the request:

1. `POST /api/ai-jobs` (via `packages/api-client`) → `ai-generation/start.ts` →
   `jobs.ts:createAiJob()`. The job row stores the encrypted input, provider,
   model, language, and preconditions (expected card version / quiz session).
   The idempotency key (`requestId`) and an active-resource dedup key are
   unique per user; a hosted credit is spent in the same transaction as the insert.
2. The job id is published to the Vercel Queue topic `ankify-ai-generation`
   (`dispatch.ts`, idempotent by job id). If publishing fails, the job is failed
   and its credit refunded. The QA profile uses `scripts/qa-worker.ts` instead.
3. `api/queues/ai-generation` → `runner.ts:processAiJob()` claims the job with
   a 270 s lease (a partial unique index allows one `running` job per user),
   re-checks the AI configuration, calls the model, and commits the business
   result together with the terminal job state in one transaction, so a
   redelivery can never create a second card or quiz.
4. States: `queued → running → succeeded | failed | cancelled | superseded`.
   Retryable errors requeue (up to `maxAttempts` = 3, 30-120 s backoff); a
   changed card version or quiz session marks the job `superseded`. Clients
   poll `GET /api/ai-jobs/:id`; `DELETE` cancels.
5. Hosted-credit refunds: `failed`, `superseded`, and cancelled-before-start
   jobs return their credit exactly once.

## Session analysis (BYOK)

One model call explains one completed practice session (`server/session-analysis/`).

- **Start**: `POST /api/ai-jobs` with `session_analyze` (manual), or planned inside
  the finish transaction when automatic analysis is on for the
  deployment (default; `ANKIFY_AUTOMATIC_ANALYSIS=disabled` switches it off),
  for the user (settings `analysis.automatic`, default on), and the session
  qualifies: a failed submission with captured code
  (`automaticAnalysisTrigger()` in core). Automatic jobs run ~15 s after Finish
  (`runAfter`), so late verdicts are read; one job per session and evidence
  digest (`auto:<session>:<digest>`); no daily cap. Only the user's own key is accepted, at creation and again before
  execution; there is no hosted fallback and no credit spend.
- **Evidence**: the whole verdict sequence plus representative code revisions
  (diffs where shorter) and judge output, bounded to 32,000 characters; what was
  left out is recorded in `coverage`. Output is schema-validated once (no repair
  loop), capped at 2,000 tokens, one provider call per attempt, three attempts.
- **Cache and staleness**: `session_analyses` rows are immutable and unique per
  (user, session, evidence digest, analyzer version, provider, model); unchanged
  evidence returns the cached analysis as an already-succeeded job. Staleness is
  computed on read against the current digest.
- **Commit**: the analysis, its `ai_suggested` candidate mistakes (one per new
  category, linked by `finding.mistakeId`), and the terminal job state commit in
  one transaction. A newer analysis replaces the session's earlier *open*
  candidates (confirmed and dismissed ones stay; a category already confirmed
  gets no new candidate). Findings that cite no attempt, and all findings when
  the model reports `insufficientEvidence`, are dropped server-side.
- **Corrections**: confirming with another category is one PATCH
  (`status` + `primaryCategory`). The suggested category stays readable as
  `MistakeRecordDto.suggestedCategory` (from the candidate's request id), so
  "corrected from" is shown without a schema change.
- **Budgets**: manual 10 per local day; automatic has no cap (bounded by
  eligibility, one job per evidence state, and `MAX_ACTIVE_JOBS_PER_USER`).
  Active jobs and jobs that reached a provider attempt count toward the manual
  budget; cache hits and jobs that ended before any attempt do not.
- **Provider errors**: 401/403, or an auth failure reported without a status
  (invalid key, `LoadAPIKeyError`), fail the job at once (`ai_request_rejected`);
  429 and 5xx retry, never sooner than the provider's `Retry-After`.
- **Dispatch recovery**: `ai_jobs.dispatched_at` marks queue acceptance. Queued
  jobs without it are re-sent by `redispatchStrandedJobs()`, from the popup's
  overview request, the analysis state request, and
  `GET /api/cron/ai-dispatch` (Bearer `CRON_SECRET`; not yet scheduled).
- **Read**: `GET /api/practice-sessions/:id/analysis`; the extension panel and
  the web problem page (Sessions tab, loaded when visible) show status and
  confirm/correct/dismiss controls. The Mistakes tab lists open suggestions
  first; manual entry is a secondary link.
- **Kill switch**: `ANKIFY_DISABLED_WORKFLOWS=session_analysis` refuses new jobs
  (`503 workflow_disabled`) and fails queued ones before any provider call.
  Stored analyses, candidates, and confirmed mistakes stay.

## New-problem suggestions

Suggestions target problems the user has never attempted
([plan](EXTENSION_FIRST_REFACTOR_PLAN.md#recommendations)); no model invents
or explains them.

- **Candidates** need verified metadata: a title, a difficulty, and LeetCode's
  paid flag as read from LeetCode, with the time it was read. Sources:
  - similar questions of problems the user practiced. The extension sends
    them with the problem, and `upsertLeetcodeProblem()` records them in the
    same transaction.
  - the committed catalog (`server/suggestions/catalog.json`), generated from
    LeetCode's problem list by `scripts/leetcode-catalog.js`. It is empty until
    generated.
- **Attempted problems** are never suggested. They are:
  - every problem row, archived ones included;
  - `attempt_history`, which holds LeetCode status reads, the user's own
    "already attempted", and the slug of a deleted problem. Deleting a problem
    records its slug first, so it can never look new.
- **Coverage**: history counts as complete only for a coverage scope read to
  its last page. Nothing infers completeness from a partial list.
- **Planner**: `planSuggestion()` (`packages/core/src/suggestions/`) is pure
  and deterministic. Its seed is the user, local date, ordinal, and planner
  version.
  - Once the profile is personalized, weak dimensions confirmed across
    problems share suggestions through the daily feed's weighted rotation;
    the rest is general practice.
  - A targeted pick prefers similar questions of problems with confirmed
    mistakes in the dimension, then topic affinity, then the same or easier
    difficulty.
  - General practice prefers the user's practiced topics and their recent
    difficulty (Easy with no history).
  - Explanations state only what the metadata shows. "Similar to X" names a
    category only when a mistake of that category was confirmed on X; a
    topic-only match is reported as a topic.
- **Persistence**: `suggestions` rows freeze each target, its explanation, the
  planner version, and a novelty label.
  - Novelty is `no_prior_attempt_found` only when a LeetCode account's
    accepted and tried lists were both read to the end within 30 days;
    otherwise it is `unverified`.
  - Unique indexes cover (user, local date, ordinal), (user, request id), and
    (user, slug) while pending, so racing requests cannot duplicate a slot or
    a target.
  - `POST /api/suggestions` with `daily` allocates the day's suggestion once
    and later returns it; `extra` appends the next ordinal (at most 20 a day).
    Nothing is stored when no problem is eligible.
  - `POST /api/suggestions/:id/actions` acts once per suggestion, idempotent
    per request id:
    - skip and already attempted store today's replacement in the same
      transaction, and already attempted also records `user_marked` history;
    - start runs the practice-session start in the same transaction
      (`startSessionInTransaction()`). A problem new to Ankify starts initial
      learning; one already in the deck is started by id, so its own metadata
      is never overwritten.
  - Any new practice session on a problem with a pending suggestion (from the
    popup, the problem page, or after opening it from `/suggestions`) marks
    that suggestion started and links the session, in the start's
    transaction.
  - A started suggestion reports its session's outcome on read.
  - `GET /api/suggestions` lists today's suggestions.
  - `POST /api/attempt-history` merges LeetCode status reads, with their
    coverage.
  - The kill switch is `ANKIFY_DISABLED_WORKFLOWS=suggestions`.

## Study Coach

Suspended by default; see the note under Asynchronous AI generation. The web
app no longer mounts the Coach UI. The server runtime below remains, guarded,
until the legacy code is removed.

- `POST /api/agent/turns` → `agent/store.ts:beginAgentTurn()` creates the
  session (on first message), an idempotent run with its page/problem context,
  and the user message, and spends a hosted credit, all in one transaction.
  One run per session may be active.
- `agent/runtime.ts` runs an AI SDK `ToolLoopAgent` (max 8 steps, 175 s) with
  tools from `agent/tools.ts`: read tools (queue, problems, context,
  submissions, cards, quiz state) run immediately; `open_problem` navigates;
  card/quiz writes are *proposals* that create an AI job only after the user
  approves (`/api/agent/steps/:id/approve`).
- Events stream as NDJSON. Client disconnect aborts the model call
  (`agent_interrupted`, no credit refund); other failures mark the run failed
  and refund. Stale runs are failed as interrupted on the next turn. Long
  sessions are compacted into summaries (`compaction.ts`).

## Paid AI credits (summary)

New purchases are suspended by default; see the note under Asynchronous AI
generation. Balances, the ledger, refunds, and the webhook still work.

Optional Stripe Checkout credit packs, off unless Stripe keys and the hosted AI
key are configured. Routes: `POST /api/billing/checkout` (session-only) and
`POST /api/billing/webhook` (public, signature-verified). Credits are granted
once per Checkout Session from the authoritative Session state and tracked in an
append-only ledger. Full design, invariants, and test instructions:
[PAID_AI_CREDITS.md](PAID_AI_CREDITS.md).

## Rate limits and caps

`server/rate-limit.ts` is a DB-backed fixed-window limiter per user and scope
(`agent` 12/min, `ai` 20/min, `capture` 60/min, `sessions` 120/min, `mistakes` 60/min, `suggestions` 60/min, `billing` 10/min). Hard caps
limit cards and quiz sessions per problem and active AI jobs per user.

## The extension

The extension is the daily surface ([plan](EXTENSION_FIRST_REFACTOR_PLAN.md)).
Three contexts, each with one job:

- **Content script** (`src/content/`, LeetCode problem pages only): reads
  LeetCode through its own GraphQL endpoint with the page's session
  (`leetcode-client.ts`; every read reports `available`, `signed_out`,
  `unavailable`, or `partial`, so an error is never "no submissions"), tracks
  the practice session of the problem in the URL (`page-session.ts`: foreground
  activity from visibility and focus only, polling every 15 s while visible and
  at once on focus, a final poll before Finish), and renders the compact panel
  in a shadow root (`panel.ts`). Resetting LeetCode's editor is an explicit
  action; "Import past submissions" stores history for a problem already in
  the deck through `POST /api/capture` (never a schedule change).
- **Background worker** (`src/background/`): the only API client. It validates
  every message and its sender (`shared/protocol.ts`: top-frame LeetCode
  problem pages or this extension's pages), attaches each tab's owner token
  (`chrome.storage.session`, never visible to pages), requires the server to
  acknowledge a start, and sends finish, abandon, ratings, and observations
  through a durable IndexedDB outbox (`outbox.ts`): persisted before sending,
  replayed with the same id, delivered in order per session, paused on 401,
  scoped to one account and API origin, retried with backoff and a
  `chrome.alarms` wake-up. The toolbar badge shows due reviews plus pending
  ratings.
- **Popup** (`src/popup/`): today's view from `GET /api/review/overview` (open
  sessions, pending ratings, due and upcoming problems), today's new-problem
  suggestions, notes for the problem in the active tab, and settings
  (language, theme, sync status).
  - Suggestions (`background/suggestions.ts`):
    - it asks for the day's suggestion when today has none;
    - its actions are Start practice, Skip, Already attempted, and Another
      suggestion;
    - each shows its explanation and its novelty label.
  - Opening a due review, or starting a suggestion, starts the session before
    navigating and binds the session's token to the new tab. An open tab of
    the problem uses its own token.
  - When that tab sets the session's baseline, it also sends the LeetCode
    metadata it just read. This completes a problem created from stored
    metadata (description, topics, similar questions).

The API origin is fixed at build time (`ANKIFY_EXTENSION_API_ORIGIN`); the
extension reuses the web session cookie, and production CORS allows only
`ANKIFY_EXTENSION_ORIGINS`. Permissions: `storage`, `tabs`, `alarms`; hosts:
`leetcode.com` and the API origin.

## Web pages

- `/`: the public landing (signed-in users go to `/today`).
- `/today`: the dashboard and onboarding. `server/dashboard.ts` gathers the
  popup's review overview, the last week's completed sessions, recent
  practice, focus areas from the profile, and today's suggestions.
- `/problems` and `/problems/[id]`:
  - archive, unarchive, delete;
  - the Mistakes tab;
  - the Sessions tab (evidence, active time, rating);
  - History as the scheduling timeline of ratings and initial-review
    schedules;
  - the next review date;
  - "Practice on LeetCode".
- `/suggestions`: today's new-problem suggestions, the same items as the
  popup.
- `/analysis`: the mistake profile, then the FSRS dashboard.
- `/settings`: AI provider, AI credits, language and region, review schedule
  and first-review delay, session-analysis automation, account export and
  delete.
- `/privacy` and `/terms`.

The retired web review workspace (`/review`) redirects to
`/today?retired=review`, which explains that reviews happen on LeetCode.

## Testing

- `pnpm test` runs Vitest from the repo root (`vitest.config.ts` maps `@/` to
  `apps/web/src`).
- Database tests use `apps/web/src/server/test-db.ts`, which points `getDb()`
  at a throwaway, fully migrated SQLite file (never Turso). Failure injection
  uses SQLite triggers created through `testDb.exec()`.
- Local libSQL runs transactions synchronously: concurrent in-process writers
  fail fast with `SQLITE_BUSY` rather than interleave, and a failed
  `BEGIN IMMEDIATE` can leave that process's connection locked. Keep such
  concurrency tests in their own file (see `*.concurrency.test.ts`).
