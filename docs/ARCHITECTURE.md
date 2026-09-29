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
| `problems` | One LeetCode problem per user; holds the FSRS state (problem-level scheduling), notes, `archivedAt` |
| `submissions` | Captured attempts incl. code and failing test details |
| `cards` | Q&A flashcards; `aiStatus` `candidate | failed | ready`; integer `version` for optimistic concurrency |
| `quiz_sessions` | 5-item quizzes (`active | completed | archived`), answers, score |
| `review_events` | Append-only history with FSRS snapshots; ratings are undone by stamping `undoneAt` |
| `mistake_records` | User-confirmed causes of failure, linked to a submission, quiz answer, or rating; partial unique indexes dedupe per source and category (see MISTAKE_PROFILE_PLAN.md) |
| `ai_jobs` | Durable async Card/Quiz generation commands (see below) |
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

- FSRS-6 via `ts-fsrs` in `packages/core/src/fsrs.ts`: `rate()`, `preview()`
  (all four outcomes), `retrievability()`. Elapsed days are recomputed from
  `last_review`, never trusted from storage.
- Only the **problem** is scheduled. Cards and quizzes support recall; a quiz
  score only *suggests* a rating (0-1 Again, 2 Hard, 3-4 Good, 5 Easy).
- `POST /api/review/rate` stores a pre-rating snapshot in the event's
  `metadata.undo`; `POST /api/review/undo` restores it (guarded by
  `fsrsReps = prev.reps + 1`) and stamps `undoneAt`.
- The due condition (`server/due-problems.ts`) excludes archived problems; the
  daily limit and time zone come from per-user review settings.

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

Providers: Anthropic, OpenAI, and OpenAI-compatible presets (DeepSeek) built in
`server/ai.ts`. DeepSeek thinking can be disabled per call.

## Asynchronous AI generation (cards and quizzes)

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

## Study Coach

- `AgentShell` in the authenticated layout opens Coach beside any page.
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

Optional Stripe Checkout credit packs, off unless Stripe keys and the hosted AI
key are configured. Routes: `POST /api/billing/checkout` (session-only) and
`POST /api/billing/webhook` (public, signature-verified). Credits are granted
once per Checkout Session from the authoritative Session state and tracked in an
append-only ledger. Full design, invariants, and test instructions:
[PAID_AI_CREDITS.md](PAID_AI_CREDITS.md).

## Rate limits and caps

`server/rate-limit.ts` is a DB-backed fixed-window limiter per user and scope
(`agent` 12/min, `ai` 20/min, `capture` 60/min, `mistakes` 60/min, `billing` 10/min). Hard caps
limit cards and quiz sessions per problem and active AI jobs per user.

## Capture and the extension

- The content script reads LeetCode via GraphQL (problem, submissions, failure
  details) and `POST /api/capture` upserts the problem idempotently by slug and
  seeds FSRS state.
- The background worker sets a gold `!` badge when the current problem has an
  accepted submission but is not captured (`/api/problems/by-slug`, 60 s cache).
- The popup/side panel offers Today, Problem (Review: Quiz/Card/Notes; Manage:
  cards and AI candidates), and Settings. AI work goes through the same
  durable jobs as the web app.

## Web pages

`/` public landing (signed-in users go to `/today`), `/today` due queue and
onboarding, `/review` resizable workspace (question, Quiz/Cards/Submissions/
Notes, optional Coach) with keyboard shortcuts and Undo, `/problems` and
`/problems/[id]` (archive/unarchive/delete, Mistakes tab), `/analysis` FSRS dashboard,
`/settings` (AI provider, AI credits, language/region, review schedule,
account export/delete), plus `/privacy` and `/terms`.

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
