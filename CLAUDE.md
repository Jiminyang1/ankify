# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install                # install deps (pnpm workspaces)
cp .env.example .env.local  # fill in Better Auth/Google, encryption secret (LOCAL profile)

pnpm db:generate            # drizzle-kit generate (after schema changes; uses LOCAL profile)
pnpm db:migrate             # apply migrations to local SQLite (packages/db/local.db)
pnpm db:migrate:prod        # apply migrations to prod Turso (requires .env.production.local)
pnpm db:studio              # drizzle-kit studio against local SQLite
pnpm db:studio:prod         # drizzle-kit studio against prod Turso
pnpm plans:sync             # re-snapshot LeetCode study plans into packages/core
pnpm db:backup              # dump prod Turso into backups/ankify-prod-<ts>.db (gitignored; requires .env.production.local)
pnpm db:release             # db:backup, then db:migrate:prod

pnpm dev                    # migrate local DB, then Next.js web app on :3000 (LOCAL profile)
pnpm dev:ext                # Chrome extension build in watch mode
pnpm dev:all                # web + extension together
pnpm dev:qa                 # web app on the QA DB (packages/db/qa.db); qa:reset wipes it
pnpm dev:demo               # English demo deck on the QA DB (README/landing screenshots); login at /api/qa/login
                            # /api/qa/login?as=fresh signs in as a brand-new empty account (wiped on every login) for onboarding runs

pnpm typecheck              # run tsc --noEmit across all packages
pnpm lint                   # run linter across all packages
pnpm test                   # vitest run (root config)
pnpm build                  # production build across all packages
pnpm release:check          # typecheck + lint + test + build + extension manifest check + prod audit
```

The root `scripts` in `package.json` delegate to workspace packages via pnpm filters (`--filter @ankify/web`, `--filter @ankify/extension`, `--filter @ankify/db`).

### Profiles

Each profile has its own env file and its own script suffix so a local migration can never accidentally hit Turso (and vice versa):

| Profile | Activated by | DB | Env file |
| --- | --- | --- | --- |
| `local` (default) | `pnpm dev`, `pnpm db:migrate`, `pnpm db:studio`, `pnpm db:generate` | SQLite at `LOCAL_DB_PATH` (defaults to `packages/db/local.db`) | `.env.local` |
| `qa` | `pnpm dev:qa`, `pnpm dev:demo`, `pnpm db:migrate:qa` | SQLite at `packages/db/qa.db` | `.env.qa` + `.env.qa.local` |
| `preview` | `pnpm db:migrate:preview`, `pnpm db:studio:preview` | Preview Turso | `.env.preview.local` |
| `production` | `pnpm db:migrate:prod`, `pnpm db:studio:prod` | Turso (`TURSO_DATABASE_URL`) | `.env.production.local` |

The selector is `process.env.ANKIFY_PROFILE`. `:prod` / `:preview` / `:qa` scripts set it; everything else defaults to `local`. The QA profile signs in through `/api/qa/login` and never publishes AI jobs to Vercel Queues. `loadDbEnv()` in `packages/db/src/client.ts` reads the matching env file; both `migrate.ts` and `drizzle.config.ts` go through it so drizzle-kit and the migrate runner stay aligned. Production runtime on Vercel reads env vars from the Vercel dashboard, NOT from `.env.production.local` — the file exists only so the developer can run prod migrations from their laptop.

## Architecture

Monorepo: `apps/web` (Next.js), `apps/extension` (Chrome MV3), and four packages: `db`, `core`, `contracts` (Zod request schemas + public DTOs shared by web and extension), and `api-client` (the AI-job client both apps use to start and poll jobs).

### `packages/db` - Database layer

- Drizzle ORM schema in a single file: `src/schema.ts` (Better Auth `user`, `session`, `account`, `verification`; business tables `problems`, `submissions`, `cards`, `quiz_sessions`, `review_events`, `settings`; AI tables `ai_jobs`, `agent_sessions`, `agent_runs`, `agent_messages`, `agent_steps`)
- `client.ts` exposes a singleton `getDb()`. Production requires `TURSO_DATABASE_URL`; `LOCAL_DB_PATH` is a development-only SQLite fallback.
- `migrate.ts` applies `drizzle/` migrations; run via `pnpm db:migrate`
- Schema infer types are re-exported (e.g. `Problem`, `Card`, `QuizSession`, `ReviewEvent`, etc.)

**Business data isolation**: every user-owned table carries `userId` (all business and AI tables above). `problems.leetcodeSlug` and `leetcodeId` are unique per user, not globally.

**Problem docs** (`docs/coach-practice.md`): each problem keeps two markdown docs. `problems.notes` (Notes) and `problems.cards_md` (Cards: each `##` heading is a prompt, the text under it the answer), each with a version (`notes_version`, `cards_version`) that every write bumps and checks. `card_stats` holds per-card practice stats (keyed by card key). Parsing and edits are pure functions in `packages/core/src/problem-docs.ts` (`parseCards`, `cardKey`, `applyCardsEdit`, `applyNotesEdit`); `server/problem-docs.ts` loads, saves (version-checked), and applies edits. Migration `0019_cards_to_docs` copied ready card rows into `cards_md`; the QA/demo seeds write both.

**Practice sessions table** (`practice_sessions`, `docs/coach-practice.md`): one Practice run on a problem. `mode` is `talk` (version 2, the default: `targets_json` from `selectPracticeTargets()`, graded per target in `results_json.talk` by the Coach's `grade_answer`; the last grade completes it, scores it with `scoreTalk()`, and updates the targeted weak spots: correct twice resolves, a miss counts as a repeat) or `recall_check` (stage 2: cards then generated questions). `recall_json` copies the selected cards as shown; `check_status` (`pending | ready | failed | skipped`) and `check_json` hold the generated questions with `answerIndex` (never sent before answering); `results_json` records recall and answers; completion sets `score` and `suggested_rating`; `debriefed_at` marks the Coach debrief. At most one `active` session per problem (partial unique index). `agent_steps.practice_session_id` links a Coach `practice` step to its session.

**Weaknesses** (`weaknesses`, `weakness_categories`; `docs/coach-practice.md` version 2): one row per specific mistake on a problem, with a category (13 built-in keys with descriptions in `packages/core/src/weaknesses.ts`, plus the user's approved custom ones), a one-line detail, evidence (submission ids, practice session ids, the Coach run), status `active | resolved | dismissed`, and a hit count. `server/weaknesses.ts` records them (category must exist, evidence must belong to the problem, a near-duplicate of an active one bumps it and reopens a resolved one) and computes the cross-problem profile on read (`computeWeaknessProfile`). `agent_steps.weakness_id` links a Coach `weakness` step.

**Cards table** (legacy; the extension and the Coach use the Cards doc, the web review and problem pages still read rows) (10 columns): `id`, `userId`, `problemId`, `question` (front), `answer` (back), `aiStatus` (candidate/failed/ready), `errorMessage`, `version` (bumped on edit; AI follow-up jobs check it so they never overwrite a newer edit), `createdAt`, `updatedAt`. No extra metadata - just Q&A with lifecycle tracking.

**AI jobs table**: one row per card/quiz generation (`card_generate | card_followup | quiz_generate | quiz_regenerate | quiz_next_batch`), status `queued | running | succeeded | failed | cancelled | superseded`. The input is stored encrypted; `activeDedupKey` allows one live job per logical slot, and at most one job per user runs at a time.

**Agent tables**: persistent Study Coach conversations. A session holds runs (one per user turn, with page/problem context and token counts), messages, and steps (`read | navigation | proposal`). Proposal steps wait for the user to approve them, which starts an AI job.

**Quiz sessions table**: per-problem review quiz sessions with `status` (`active | completed | archived`), `itemsJson` (5 generated quiz items with source + scope), `answersJson`, `score`, timestamps, and cascade delete through `problemId`.

**Settings table**: per-user key/value store keyed by `(userId, key)`. AI settings include provider/model plus an AES-GCM encrypted API key envelope; API responses expose only `hasApiKey`, never the raw key. `leetcode-account` holds the linked LeetCode username plus a cached copy of that user's public profile. `study-plan` is the plan the profile shows; `custom-study-plans` holds up to 5 plans imported from public LeetCode lists (slug `list:<list slug>`).

### `packages/core` - Shared business logic

- `fsrs.ts`: wraps `ts-fsrs` - `rate()` computes next review for one rating, `preview()` returns all 4 rating outcomes at once via `repeat()`, `retrievability()` returns 1 for new cards, `emptyCardState()`
- `types.ts`: shared TypeScript types (`LeetCodeDifficulty`, `AiProvider`, `FsrsRating`)
- `ai-catalog.ts`: suggested models per provider and the native reasoning levels each accepts (client-safe; shared by Settings, onboarding, and the server)
- Request schemas are not here: Zod schemas for capture, cards, AI jobs, review rating, quiz answers, scoped quiz items, and agent turns live in `packages/contracts/src/schemas.ts`, next to the public DTOs.
- `quiz-format.ts`: small Markdown formatter that wraps complexity expressions, DP states, and code-like variables in inline code before rendering quiz text.
- `leetcode-tags.ts`: LeetCode tag catalog keyed by slug. `leetcodeTagSlug()` maps any past name or slug to the canonical slug; `leetcodeTagName()` gives the current display name. `problems.topicTags` stores slugs (capture normalizes names from older extension builds), so render tags through `leetcodeTagName()`.
- `study-plans.ts`: the plans behind the profile roadmap.
  - Official plans (`OFFICIAL_STUDY_PLANS`) are LeetCode's own: Top Interview 150 (default), LeetCode 75, Top 100 Liked, and the DP / Graph Theory / Binary Search plans. They come from the snapshot in `study-plans.generated.ts` (regenerate with `pnpm plans:sync`; never edit by hand; Top 100 Liked is re-sorted into learning order).
  - Imported lists are grouped into patterns from LeetCode tags by `groupByPattern()`. `planProblemStatus()` answers two questions per problem with four states: solved on LeetCode? (`todo` / `solved`) and, for problems in the deck, due? (`due` / `remembered`). Archived deck problems count as `solved`. FSRS's finer states never reach the UI.

### `apps/web` - Next.js 16 App Router

- **Auth and isolation**:
  - Better Auth handles Google OAuth through `/api/auth/[...all]`.
  - Production is fail-closed without `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, Google credentials, and `AI_KEY_ENCRYPTION_SECRET`.
  - Signup is public for any Google account by default. `ANKIFY_DISABLE_SIGNUP=true` pauses only new account creation.
  - Middleware is only a lightweight redirect/CORS gate. Server pages must call `requirePageUser()` and API routes must call `getRequestUser()` or `getRequestSessionUser()`.
  - Every business query must be scoped by the current `userId`, including raw SQL dashboard queries.
  - Extension requests use `credentials: include` and reuse the Better Auth web-session cookie. `ANKIFY_EXTENSION_ORIGINS` must list exact trusted extension IDs in production.

- **API routes** under `src/app/api/`:
  - `auth/[...all]/` - Better Auth route handler for Google OAuth sessions and auth callbacks.
  - `me/` - returns the current session user; used by extension automatic login detection and Test connection.
  - `capture/` - extension hits this to upsert problems + submissions. Idempotent by `leetcodeSlug`, stores `leetcodeId` when present, and seeds FSRS state for new problems. `firstReview: "next_day"` (sent by the extension's automatic collection) makes a new problem's first review due 24h later instead of at once; it never touches problems already in the deck.
  - `problems/` - list problems with card counts. Supports `?search=` for title search and `?archived=1` to list archived problems instead of active ones.
  - `problems/[id]/` - PATCH accepts `{ notes }` (autosave from review) and/or `{ archived }` (sets/clears `archivedAt`; archived problems keep all data but leave the review rotation). DELETE permanently removes the problem and cascades to its submissions, cards, quiz sessions, and review events.
  - `problems/by-slug/[slug]/` - extension lookup by LeetCode slug. Returns problem, ready cards, candidates, FSRS previews, and queue state.
  - `problems/by-slug/[slug]/submissions/` - GET the LeetCode submission ids already stored (404 when not captured); POST `{ submissions }` appends missing ones. Append-only: unlike `/api/capture` it never updates the problem row, so it can't un-archive.
  - `problems/[id]/user-card/` - POST saves a manual card directly as `ready` (just `question` + `answer`).
  - `problems/[id]/ai-cards/` - GET returns candidate/failed cards. Generation itself goes through `ai-jobs/`.
  - `problems/[id]/quiz/` - GET current non-archived quiz session; DELETE wipes every quiz session for the problem so the next batch starts with no history. Generation goes through `ai-jobs/`.
  - `problems/[id]/practice/` - GET the session to resume (active, or completed and not yet debriefed; `null` if none); POST starts one (or returns the active one). Starting picks cards by `selectPracticeCards()` and starts a `practice_check` AI job; without AI the session is cards-only (`skipped`), and with no cards either it returns `nothing_to_practice`.
  - Talk-through practice: starting returns the targets and no job; while it's active every Coach turn on that problem carries `context.practiceActive` (targets and grades, set server-side), and the Coach asks one open question per target and grades it with `grade_answer`. A `trigger: { type: "practice_start" }` turn makes the Coach ask the first question; `trigger: { type: "analyze_attempts" }` runs `server/agent/analyze-attempts.ts` first (one structured call whose findings go through `recordWeakness()`), then the Coach explains them.
  - `practice/[id]/` - GET session state (reconciles a check job that ended without questions, and completes the session when everything is answered). `practice/[id]/recall/` POST `{ key, result }` (also updates `problems.card_stats`); `practice/[id]/check/` POST `{ itemId, choice }`, graded on the server.
  - `problems/[id]/weaknesses/` - GET the problem's weak spots (active first; dismissed hidden). `weaknesses/[id]/` PATCH `{ status }` removes (dismissed), resolves, or reopens one. `weaknesses/profile/` GET the cross-problem profile by category.
  - `problems/[id]/docs/` - GET Notes and Cards (markdown, versions, parsed cards, parse issues); PUT `{ target, markdown, expectedVersion }` saves the user's own edit (409 on a stale version).
  - `problems/[id]/review-resource/` - GET `?resource=cards|submissions|notes`: one review-workspace tab's data, loaded lazily.
  - `ai-jobs/` - POST starts a card, quiz, or practice-check generation job (`card_generate` from auto or rawText, `card_followup` with an instruction and `expectedCardVersion`, `quiz_generate`, `quiz_regenerate`, `quiz_next_batch`). Idempotent by client `requestId`, rate-limited, returns 202 while queued/running. GET `?problemId=&kind=&active=true` lists a problem's jobs. `quiz_next_batch` requires the current session to be completed, archives it, and puts recent completed quiz history into the prompt.
  - `ai-jobs/[id]/` - GET polls one job; DELETE cancels it.
  - `queues/ai-generation/` - Vercel Queues consumer (topic `ankify-ai-generation`). Runs `processAiJob()` under a lease; transient provider failures retry with backoff up to `maxAttempts`.
  - `agent/turns/` - POST one Study Coach turn (from the web sidebar or the extension's Coach tab); streams NDJSON events (`run_started`, `text_delta`, `step`, `done`, `error`). Rate-limited and spends one starter credit per turn. A `trigger: { type: "practice_completed", practiceSessionId }` turn is a debrief: the server loads the session's results into `context.practice` (clients can't set it) and marks the session debriefed. Tools (`server/agent/tools.ts`) read the review queue, the profile's study plan (`get_study_plan`: per-pattern status counts, next not-started problems, problems forgotten before), problems, submissions, the problem's docs (`get_problem_docs`), and quiz state, open a problem, and *propose* a doc edit (`propose_doc_edit`: append/replace a Notes section, add/update/remove a card; validated against the current doc before it's proposed, applied on approval with a version check) or a quiz generation, and start a practice session (`start_practice`, a `practice` step the panel renders; it ends the turn). Weak spots: `get_weaknesses` (this problem's, the profile, and the categories with descriptions), `record_weakness` (recorded at once as a `weakness` step the user can remove; at most 3 per run), `propose_weakness_category` (a proposal; approving adds the category). At most 3 doc proposals per run. From the extension, the turn's context is `page: "leetcode"` with `leetcode: { slug, title?, editor?: { language, code } }` (code capped at 20k chars; `problemId` is null for unsaved problems). Only the newest turn keeps the editor snapshot: `withoutEditorCode()` strips it from replayed history, compaction input, and run DTOs.
  - `agent/sessions/`, `agent/sessions/[id]/` - list and load Coach conversations.
  - `agent/steps/[id]/approve|dismiss/` - approving a proposal starts its AI job (idempotent once accepted), or for a `doc_edit` applies it and returns the docs (409 with a message when the doc changed since); dismissing drops it.
  - `onboarding/` - session-only GET progress; POST `{ action: "extension_connected" | "skip_ai" }`.
  - `account/` - session-only DELETE `{ email, confirmation: "DELETE" }` removes the user and cascades all data. `account/export/` downloads the user's data (no login secrets or key envelopes).
  - `problems/[id]/quiz/[sessionId]/` - PATCH one quiz answer. Repeated answers return 400; the fifth answer completes the session and computes score.
  - `problems/[id]/quiz/[sessionId]/save-card/` - POST `{ itemId }` to save a quiz item directly as a `ready` card and record a `card_created` event.
  - `cards/` - DELETE one or more cards by id.
  - `cards/[id]/` - PATCH edits question/answer or confirms a candidate card (`aiStatus: "ready"`).
  - `review/next/` - returns next due problem with FSRS previews (via `preview()`), ready cards, submissions, and notes. A due problem does not need ready cards because Quiz can start review.
  - `review/queue/` - returns today's due queue for the extension Today tab.
  - `review/rate/` - records recall self-rating + applies FSRS scheduling to the problem. Notes written to `problems.notes`. The rated event stores a pre-rating FSRS snapshot in `metadata.undo`.
  - `review/undo/` - POST `{ problemId }` reverts the most recent rating: restores the problem's FSRS fields from the event's `metadata.undo` snapshot and stamps `undoneAt` on that event (guarded by `fsrsReps = prev.reps + 1` against races; events without the snapshot return 409).
  - `settings/` - session-only GET/POST AI provider/model/encrypted key, reasoning level, generation language (`en | zh`), and daily review limit. No prompt customization.
  - `study-plan/` - session-only. POST `{ plan }` switches the profile's plan; DELETE `{ plan }` removes an imported list and falls back to the default.
  - `study-plan/import/` - session-only POST `{ link }`: reads a public LeetCode problem list (`leetcode.com/problem-list/<slug>/`) through public GraphQL, groups it by pattern, saves it, and switches to it. Re-importing the same list refreshes it.
  - `profile/add-to-review/` - session-only POST `{ slugs }` (slugs from the user's official or imported plans, max 30). Captures each problem into the deck from LeetCode's public problem data, without submissions; the extension syncs those on the next visit.
  - `leetcode/solved/` - POST `{ username, slugs }` from the extension: the signed-in LeetCode user's full solved list (slugs only). Stored in `settings` (`leetcode-solved`) and links that LeetCode account; the profile counts these problems as solved. It also marks the onboarding extension step done, since only the extension posts here.
  - `leetcode/account/` - session-only. POST `{ profile }` (username or leetcode.com profile URL) verifies the user via LeetCode's public GraphQL and stores it; DELETE unlinks. leetcode.cn returns `unsupported_site`.
  - `settings/ai-test/` - session-only POST. Runs a tiny `generateObject` probe against the configured provider/model/key (or supplied overrides) to verify the connection. Returns `{ ok, latencyMs }` on success or `{ ok: false, code, message }` on failure with categorized error codes (`invalid_api_key`, `model_not_found`, `quota_or_rate_limit`, `timeout`, `network`, `forbidden`, `unknown`).
  - `settings/ai-models/` - session-only POST. Body `{ provider, apiKey? }`. Calls the provider's `/v1/models` endpoint (Anthropic / OpenAI / DeepSeek) and returns chat-capable model ids so the Settings UI doesn't go stale when providers ship new models. Falls back to the user's stored encrypted key when `apiKey` is omitted; OpenAI list is filtered against an embeddings/audio/image/moderation block list.
- **`src/proxy.ts`**: lightweight auth gate and credentialed Chrome-extension CORS preflight handler (Next 16's `proxy` file convention; replaces the old `middleware.ts`). Web pages and extension API requests require the same Better Auth session cookie; API routes and server pages must still call the auth helpers above before touching data.
- **`src/server/`** (server-only modules; `src/lib/` holds client-safe helpers like i18n and the AI-job client):
  - AI layer (see `docs/ai-architecture.md`): `server/ai.ts` builds the model from resolved settings; `server/ai/providers/` holds one adapter per provider (the only place provider names and quirks appear: model creation, presets, retired-id aliases, per-model reasoning options, model listing); `packages/core/src/ai-catalog.ts` lists suggested models and the native reasoning levels each accepts (shared by Settings, onboarding, and the server); `server/ai/call-options.ts` returns provider-native options per call (`"user"` = the user's stored `reasoningLevel`, where `default` sends nothing and keeps thinking on; `"lightest"` for probes and summaries); `server/ai/errors.ts` classifies every provider failure by HTTP status. No call sends `temperature`/`top_p`, and none forces a tool choice.
  - `ai-generation/`: the job pipeline. `start.ts` creates the job and publishes it (`dispatch.ts`), `runner.ts` claims and runs it, `quiz.ts` / `card.ts` / `practice-check.ts` hold the per-kind generation, `jobs.ts` owns status transitions and the public DTO. `practice-check.ts` writes 3 cited questions, validates them with `validateCheckItems()` (citations resolve, 3 scopes, complexity covered, no restated card or recent question, a `mistake_review` when there's a recent failed submission), retries once with the violations as feedback, then fails the job (not retried) so the session continues cards-only.
  - `practice.ts`: practice sessions (start, recall, answer, completion, debrief summary).
  - `agent/`: the Study Coach (`runtime.ts` loop, `tools.ts`, `prompt.ts`, `store.ts` persistence, `compaction.ts` summaries of older runs).
  - `starter-ai.ts`: starter-credit config and the atomic per-user usage counter.
  - `card-prompt.ts`: builds A/B/C context (problem context / submissions / raw text) and single-draft prompts. Prompt returns only `{question, answer}` and encourages Markdown.
  - `quiz-prompt.ts`: builds 5-question quiz prompts, written in the user's generation language (English by default, Simplified Chinese when set), from problem title/difficulty/slug/tags/statement, notes, ready cards, recent submissions, failed submission details, and recent completed quiz history. Prompts require scoped items and at least one complexity question.
  - `due-problems.ts`: shared due condition (`not archived` and `fsrs_due <= now` or null).
  - `review-queue.ts`: computes due count, done-today, remaining within daily limit.
  - `settings.ts`: reads/writes per-user AI and review settings to the `settings` k/v table. Default review limit 20; AI defaults to empty, and user API keys are AES-GCM encrypted with `AI_KEY_ENCRYPTION_SECRET`. `getAiRuntimeSettings()` returns the user's own settings, or the starter-credit settings (`source: "starter"`) when the user has none and `ANKIFY_STARTER_AI_API_KEY` is set.
  - `leetcode-account.ts`: parses profile links and fetches the public LeetCode profile (solved counts, streak, latest 20 accepted). Refetches after 12h and serves the cache when LeetCode fails. Never sends or stores a LeetCode session; login-only data (full solved list) belongs in the extension.
  - `study-plans.ts`: current plan selection, imported lists, and LeetCode list import.
  - `profile.ts`: `loadProfile()` maps every problem in the current plan to its four-state status (deck FSRS due date + LeetCode solved list), with per-group counts and the next unsolved problem.
  - `rate-limit.ts`: atomic database-backed fixed-window limiter keyed by `userId` for AI and capture paths. Hard storage caps also limit problems, submissions, cards, and quiz sessions per user/problem.
- **Pages**:
  - `/` - public landing page (the only indexable page); `/welcome`, `/login`, `/privacy`, `/terms` are public too. Signed-in users are redirected to `/today`.
  - `/today` - home: due queue, progress, daily stats, and the onboarding checklist (`today/onboarding-card.tsx`) until it's done
  - `/extension-connected` - landing tab after the extension's sign-in hand-off
  - The Study Coach is a sidebar on every app page (`components/agent/agent-sidebar.tsx`); each turn carries the current page/problem as context.
  - `/review` - left statement/rating panel plus right workspace tabs: Quiz, Cards, Submissions, Notes. Keyboard shortcuts (ignored while typing or when a control has focus): `1-4` select rating, `Enter` submits (never inside the Quiz tab), `A-D` answer the current quiz question, `Space` flips cards / advances quiz feedback, arrows navigate cards; on the result screen `Enter`/`Space` load the next problem. The result screen has an Undo button (`/api/review/undo`) that re-enters the same problem. The QuizPanel auto-starts generation on problem load: no session → `generate`, completed session → `nextBatch` (archiving it), active session → resume; failures stay manual so a broken AI config can't retry-loop, and a completed quiz preselects its suggested rating.
  - `/problems` - list with difficulty/state/tag/search filters; the state filter's `Archived` option refetches with `?archived=1`
  - `/problems/[id]` - problem detail: metadata, notes, cards, submission code, review history timeline, Archive/Unarchive (archived problems hide the Review button and show a notice)
  - `/analysis` - FSRS dashboard: memory score, lapse rate, state/stability distributions, risk table, reviews/day chart, burden forecast, dev reset
  - `/profile` - study-plan roadmap. Includes:
    - a plan picker: LeetCode's plans, your imported lists, and "Import a LeetCode list";
    - summary: solved count, four-state bar, "Review N due", next problem, and "Ask Coach what's next" (opens the Study Coach with that question via `useAgentShellControls().ask()`; the Coach answers from its `get_study_plan` tool);
    - a first-step card (`profile/roadmap-start.tsx`), shown only while nothing from the plan is in review. Once LeetCode history is synced it offers "Add N to review" for the first pattern with solved problems, capped at 10 so day one fits the daily limit; otherwise it shows an install-the-extension prompt;
    - a first-visit guide to the three concepts (solved / remembered / due), dismissible and stored in localStorage;
    - the roadmap itself: Top Interview 150 is hand-drawn in `profile/roadmap-layout.ts`, other plans follow a three-per-row snake path in plan order, and everything is a plain list below `lg`; each node opens a dialog with Review / Open / Add to review / LeetCode per problem, plus "Switch to this plan" when an official topic plan goes deeper on that pattern (`deepDivePlanFor()` in core: DP, Graph Theory, Binary Search);
    - the LeetCode account link.
  - `/settings` - AI provider configuration, generation language, daily review limit, data export, account deletion

### `apps/extension` - Chrome MV3 Extension

- **Content script** (`content/leetcode.ts`): scrapes LeetCode problem pages via their GraphQL endpoint - fetches problem metadata, recent submissions, and submission details (code, status, failures). Falls back from `questionSubmissionList` to legacy `submissionList`.
- **Problem watch** (`content/problem-watch.ts` + background): the content script watches the SPA URL (plus a 60s in-place re-check and quick re-checks after Submit / Cmd+Enter) and reports the problem's recent submissions. The background worker looks the slug up via `/api/problems/by-slug/[slug]/submissions` (60s in-memory cache), then:
  - sets a per-tab gold `!` badge when the problem has an Accepted submission but isn't captured;
  - collects it on its first *new* submission, any verdict (made while the page was open, or within 10 minutes; still-judging verdicts wait), when the `autoCapture` setting is on (default). It sends `firstReview: "next_day"` and broadcasts `problem_collected` so an open side panel switches to the problem. Opening a problem, even an old solved one, never collects it;
  - posts any submissions ankify is missing for captured problems to the append-only endpoint. Ids already sent are remembered in `chrome.storage.session`.
  Missing config, sign-out, and API errors never badge or capture. A successful capture from the popup sends `capture_badge_captured` to clear matching tabs.
- **Solved-list sync**: once a day (or via popup Settings "Sync now"), a problem page reads the signed-in user's solved list from LeetCode's same-origin `/api/problems/all/` (GraphQL `questionList` status filter as fallback) and the background posts the slugs to `/api/leetcode/solved`. No LeetCode cookie or code leaves the browser.
- **Editor reader** (`content/editor-main.ts`, a second content script with `world: "MAIN"`): the only code that can see LeetCode's `window.monaco`. It answers `window.postMessage` requests from `content/editor.ts`, which serves the side panel's `read_editor` message. Keep it import-free so crxjs inlines it (MAIN world has no `chrome.runtime` for a loader). No `scripting` permission: the manifest check forbids it.
- **Background** (`background/index.ts`): MV3 service worker — side-panel behavior, problem-page handling, and solved-list sync.
- **Side panel** (`popup/`; the toolbar icon opens it, there is no separate popup):
  - Layered, not tabbed. A top bar shows what's on screen: the problem in the active LeetCode tab (number, title, difficulty, due/next review), or Today, Docs, or Settings. Its icons open the problem's Docs (book), the problem on the web, Today (badge = reviews left today), and Settings; Today, Docs, and Settings have a back button. Moving to another problem returns to it.
  - Problem view: the Coach chat is the main area (`CoachTab` in `full` mode), with this problem's weak spots pinned at the top of the thread (`popup/WeakSpots.tsx`: category, detail, how often, remove; empty state offers "Analyze my attempts", which asks the Coach to read the submissions and record what it finds), with a status strip above it only when needed (loading, not in the deck with "Add now", pinned from another tab). Each problem keeps its own conversation (`ankify.coachSession:<slug>` in extension storage); off a problem the latest one resumes. The composer is one rounded box: the text grows as you type, and its footer holds the "Include my code" toggle (code icon), **Practice** (highlighted when the problem is due), **Rate** for a due problem (opens the four rating buttons above the composer, for a review done another way like re-solving), and a round send/stop button. The chat header has two icons: past conversations (a menu of the sessions shared with the web; picking one makes it this problem's conversation) and new chat.
  - Docs (`popup/DocsPanel.tsx`, opened from the book icon) shows Notes and Cards rendered, with an edit mode whose saves are version-checked; it reloads when the Coach applies an edit. A problem not yet in the deck shows that it's collected on the first submission, with a small "Add now". Refreshing the problem on screen revalidates in place (no loading placeholder), because some children refresh on mount.
  - Not on a problem: Today (due queue) is the home screen. When the active tab leaves LeetCode, the last problem stays pinned with a "jump back" banner.
  - Practice (`popup/PracticeWidget.tsx`) runs inside the Coach chat: recall cards (reveal, then got it / missed), generated questions (graded, with explanations), then a summary with the suggested rating preselected on the four rating buttons. It calls the practice API directly, no model calls; finishing sends the debrief trigger once. The composer's Practice button starts one for saved problems; an unfinished or undebriefed session resumes on load.
  - On Today the Study Coach (`popup/CoachTab.tsx`, `dock` mode) is docked at the bottom: collapsed it's a composer; sending or "Show chat" expands it over the content. It resumes the same conversations as the web sidebar, sends the active problem plus (unless "Include my code" is off) a snapshot of the editor with each turn, streams the reply, and handles proposals (Approve starts the AI job) and navigation (opens the web app). Rename/delete stay on the web.
  - Quiz generation runs as an AI job (via `@ankify/api-client`); switching tabs keeps the pending state, and the Quiz tab picks the session up when the job finishes. Completed quizzes can create a new batch and bulk-create cards for missed items.
  - Settings: language, theme, the API base URL, preferences (including `autoCapture`), LeetCode solved-list sync status with Sync now, and Test connection (`/api/me` with the shared web session).
  - Markdown rendering is used for card answers, quiz text, explanations, Coach replies, and notes; code stays mono and regular UI stays sans.
- **Design**: CSS variables match the web app (gold accent, same bg/surface/fg colors), custom reusable scrollbars, and shared typography rules.

## Data Flow

### Capture (extension)

1. Open a LeetCode problem with the side panel open; it shows that problem.
2. The extension sends credentialed requests to the exact API origin; Chrome includes the existing Better Auth web-session cookie.
3. If the problem is unknown, the first new submission (any verdict) collects it automatically: the background reads page data through the content script and POSTs to `/api/capture` with `firstReview: "next_day"`. "Add now" in the panel captures it manually (due at once).
4. If the problem is known, the panel shows its Quiz / Cards / Notes, due state, and rating; new submissions sync through the append-only endpoint.

### Card creation

**Manual**: Write question + answer directly -> POST `/api/problems/:id/user-card` -> saved as `ready`.

**AI**: Click Auto generate or write raw text -> POST `/api/ai-jobs` with `{ action: "card_generate", problemId, rawText? }`. The client polls the job; on success the job inserts one `candidate` card. User can edit, Follow-up (a `card_followup` job that rewrites with an instruction and fails if the card was edited meanwhile), Confirm (PATCH `aiStatus: "ready"`), or Discard (DELETE).

One job creates one card: there is no AI-card batch generation, `polish`, or `generating` card status. Historical `generating` rows are removed by migration.

### Quiz review

1. `GET /api/problems/:id/quiz` returns the current active/completed quiz session or `null`.
2. `POST /api/ai-jobs` with `quiz_generate` queues a job that generates exactly 5 single-choice questions in the user's generation language. Each item has a source and scope. The client polls the job; a failed job leaves no quiz session behind.
3. Answering a choice PATCHes `/api/problems/:id/quiz/:sessionId` immediately. The API stores correctness and returns the explanation.
4. After 5 answers, the session becomes `completed`; score maps to suggested rating: `0-1 Again`, `2 Hard`, `3-4 Good`, `5 Easy`.
5. Suggested rating is only guidance. FSRS is still updated only by manual rating.
6. `Regenerate` (`quiz_regenerate`) archives existing non-archived sessions and creates a new active session.
7. `New batch` (`quiz_next_batch`) is available only after completion. It archives the completed session, passes recent completed quiz history into the prompt, and creates a new active session without repeating prior questions.
8. `Save as card` writes a ready card directly from quiz question + correct answer + explanation. Completed summaries can bulk-create cards for missed items.

### Review session

1. `GET /api/review/next` returns the next due problem with FSRS previews, ready cards, submissions, and notes.
2. User reviews Quiz/Cards/Submissions/Notes, then self-rates recall (Again/Hard/Good/Easy).
3. `POST /api/review/rate` records the rating and applies FSRS scheduling. Notes are saved to `problems.notes`.
4. Meaningful interactions write to `review_events`.
5. The result screen offers Undo (`POST /api/review/undo`), which restores the pre-rating FSRS snapshot, marks the rating event undone, and re-enters the same problem.

## Key Design Decisions

- **Multi-user deployment**: public Better Auth Google OAuth and per-user data isolation across all business tables.
- **Extension auth reuses the web session**: no separate ankify token is created, copied, or stored; signed-out users continue with Google in a web tab.
- **User-owned AI keys, plus starter credits**: users save provider/model/key in Settings, and keys are encrypted before storage. When `ANKIFY_STARTER_AI_API_KEY` is set, users without a complete own configuration fall back to that server key for a small lifetime allowance (`server/starter-ai.ts`: 1 credit per quiz job, card job, or Coach turn; atomic counter in the `settings` row `starter-ai-usage`). A user's own key always wins and never spends credits. No other server env provider key is a runtime fallback.
- **Problem-level scheduling**: FSRS state lives directly on the `problems` row. Cards and quizzes support recall, but only the problem gets scheduled.
- **Cards are simple**: `question`, `answer`, lifecycle fields only. No explanation/rationale/source fields on the card row.
- **AI card generation is user-gated**: AI card generation creates `candidate`; only confirmed cards become `ready`.
- **Quiz save-as-card is direct**: quiz items are already answered/reviewed by the user, so saving one creates a `ready` card immediately.
- **Candidate/failed cards excluded from review**: only `aiStatus='ready'` cards are served as review cards.
- **AI generation runs as jobs**: quizzes and cards go through `ai_jobs` + Vercel Queues so a slow model never holds a request open. Jobs are idempotent by client `requestId`, one runs per user at a time, and only transient provider failures retry. The Study Coach is the exception: it streams directly in its request, and anything it wants to create is a proposal the user approves.
- **Quiz batches are scoped**: each item carries `source` and `scope`; generated batches must cover at least 4 scopes and include complexity.
- **`review_events` is append-only**: snapshots of stability, difficulty, retrievability, and metadata are kept for dashboards/history. `/api/review/undo` never deletes the rating event — it stamps `undoneAt`, and done-today counts and dashboards exclude undone events.
- **FSRS scheduler recomputes elapsed_days** from `last_review` and `now` in `init()` - stored `elapsed_days` is never trusted.
- **AI defaults to empty**: without starter credits, provider/model/key must be configured before AI generation; errors should be clear. When starter credits run out, requests return `starter_credits_exhausted` (403).

## UI Conventions

The web app and the extension popup share one typographic language. **Default everywhere is sans (`system-ui` stack); mono is a marked notation, not a default.**

**Use sans (do nothing - it's the default):**
- All prose, labels, buttons, headings, nav tabs, pills, hero titles, table cells, list items.
- Numeric columns and counters. **For digit alignment, use Tailwind `tabular-nums` (CSS `font-variant-numeric: tabular-nums`) - not `font-mono`.** Sans + `tabular-nums` aligns digits without flipping fonts.

**Use mono (Tailwind `font-mono` in web; `var(--font-mono)` in extension popup CSS) only for:**
1. Real code: `<pre>` blocks and inline `<code>` rendered by Markdown components, submission code displays.
2. Shell commands and env-path tokens inside copy: `<code>pnpm db:migrate</code>`, `<code>.env.local</code>`.
3. Identifier-shaped inputs: API key, model id, API base URL. Slug displays (`two-sum`).
4. Programming-language labels rendered next to code (`python`, `cpp`).
5. The brand wordmark in `components/brand.tsx` - a deliberate logo choice, not body text. Nothing else may borrow it.

Anything else in `font-mono` is a bug - it splits the visual register and looks terminal-ish against the rest of the app.

**Extension popup CSS (`apps/extension/src/popup/popup.css`)** declares two font variables on `:root`:
- `--font-ui` - sans stack, the popup's default. Used by topbar, tabs, hero, pills, buttons, list items, today-stats, etc.
- `--font-mono` - mono stack. Used only by code, slug chips, and settings inputs for API URL/token.

If a new component needs a mono look, justify it against the four cases above; otherwise use the variable's default.

**Compose from `components/ui/`, don't re-roll it.** Every button-shaped control uses `<Button>` / `buttonClasses()` (`primary | secondary | ghost | danger` x `icon | sm | md | lg`); every bordered panel on surface color uses `<Surface>` (which owns the `rounded-xl` radius); every zero-state uses `<EmptyState>`; pending states use `<Spinner>` and `loading.tsx` files use `<Skeleton>`. Hand-writing `rounded-* border border-border bg-surface` or a bespoke accent button is how the three-different-paddings drift started. If a call site needs to override padding or radius, the size scale is missing a step - add it to the component instead.

Genuinely custom controls are the exception and stay raw: rating buttons, quiz answer choices, segmented tab triggers, full-width disclosure rows, and plain text links.

**Colors come from the semantic tokens** (`bg`, `surface`, `subtle`, `fg`, `muted`, `border`, `accent`, `accent-soft`, `success`, `warning`, `danger`, `easy`, `medium`, `hard`). A raw Tailwind palette class like `text-red-600` is a bug; use `text-danger`. `apps/extension/src/popup/popup.css` mirrors the same token names and values in all four theme blocks - change one side and you must change the other.

**Focus is never removed.** `globals.css` gives `button / a / input / textarea / select / [role=button]` a `:focus-visible` outline. If an element opts out, it must supply its own indicator - use `.focus-inset` for borderless full-panel editors where an offset ring would fall outside the panel.

**No arrow glyphs in buttons.** `->`, `→`, `←`, `»` inside a label look cheap; drop them from text buttons, and use a drawn SVG icon for glyph-only controls (see `ChevronIcon` / `CheckIcon` in the extension popup). An ellipsis as a pending state is the same problem - use the spinner.

**Editor to rendered-markdown parity.** Where a textarea coexists with a Markdown view of the same content, the textarea must use the same font/size/leading as the rendered output so the visual transition is invisible. Do not apply `font-mono` to such textareas - Markdown's own `<pre>`/`<code>` styles switch to mono locally.

## Terminology

- **problem** = a LeetCode problem stored in `problems`; the unit FSRS schedules.
- **card** = a flashcard with `question` (front) and `answer` (back).
- **candidate** = an AI-generated card draft, not yet confirmed.
- **quiz session** = a per-problem set of 5 multiple-choice questions plus user answers and score.
- **retrievability** = probability the user still remembers (0-1), computed by FSRS.
- **stability** = how well a memory is consolidated (days until retrievability drops to 90%).
