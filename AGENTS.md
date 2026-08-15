# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install                # install deps (pnpm workspaces)
cp .env.example .env.local  # local SQLite: fill Better Auth/Google + encryption secret; leave TURSO_* empty

pnpm db:generate            # drizzle-kit generate (after schema changes)
pnpm db:migrate             # apply migrations to local/remote Turso
pnpm db:studio              # drizzle-kit studio (browse DB in browser)

pnpm dev                    # apply local DB migrations, then start Next.js web app on :3000
pnpm dev:web                # same as pnpm dev
pnpm dev:all                # apply local DB migrations, then run web + extension watch together
pnpm dev:ext                # Chrome extension build in watch mode

pnpm typecheck              # run tsc --noEmit across all packages
pnpm lint                   # run linter across all packages
ANKIFY_EXTENSION_API_ORIGIN=https://ankify-pi.vercel.app pnpm build
                            # production build across all packages
```

The root `scripts` in `package.json` delegate to workspace packages via pnpm filters (`--filter @ankify/web`, `--filter @ankify/extension`, `--filter @ankify/db`).
A bare Production extension or root build intentionally fails closed: always
pass the canonical `ANKIFY_EXTENSION_API_ORIGIN` shown above. Development watch
mode defaults to `http://localhost:3000` and does not require the variable.

## Architecture

Modular monolith: one Next.js deployment plus the Chrome extension. Browser-safe
contracts and HTTP helpers are shared packages; database and application logic
stay inside explicit server boundaries.

### Production deployment identity

- Canonical Web/API origin: `https://ankify-pi.vercel.app`.
- Production data is Turso provisioned through the Vercel Turso integration:
  organization `vercel-icfg-mdehlkeeqefnm8sqwfj1zlce`, database
  `database-ankify`.
- The personal Turso database `ankify-prod` is legacy, write-blocked, and not
  connected to Vercel Production. Never infer the target from the Turso CLI's
  current organization or a plausible database name.
- Runtime uses only `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
  `ANKIFY_NEW_DB_TURSO_*` variables are not application inputs.
- Before a Production write, follow `docs/DEPLOYMENT.md`: explicitly switch to
  the integration organization, verify the URL and read-only row/migration
  counts, then run `pnpm db:release` with a short-lived token.

### `packages/contracts` - Transport contracts

- Zod request schemas and JSON-safe response DTOs shared by Web, Extension, and DB JSON columns.
- Transport dates are ISO strings. Browser code must not import `@ankify/db` types.
- Do not return raw Drizzle rows from public APIs; select/map only the fields in the relevant DTO.

### `packages/api-client` - Shared HTTP client

- Isomorphic client code used by both Web and Extension for durable AI job creation, polling, and errors.
- The caller supplies the request function, so Web keeps same-origin URLs and Extension keeps its credentialed base URL/auth handling.

### `packages/db` - Database layer

- Drizzle ORM schema in a single file: `src/schema.ts` (Better Auth `user`, `session`, `account`, `verification`; business tables `problems`, `submissions`, `cards`, `quiz_sessions`, `ai_jobs`, `review_events`, `settings`; and persistent Agent tables `agent_sessions`, `agent_runs`, `agent_messages`, `agent_steps`)
- `client.ts` exposes a singleton `getDb()`. Production requires `TURSO_DATABASE_URL`; `LOCAL_DB_PATH` is a development-only SQLite fallback.
- `migrate.ts` applies `drizzle/` migrations; run via `pnpm db:migrate`
- Schema infer types are re-exported (e.g. `Problem`, `Card`, `QuizSession`, `ReviewEvent`, etc.)

**Business data isolation**: all user-owned tables carry `userId`, including AI jobs and every Agent table. `problems.leetcodeSlug` and `leetcodeId` are unique per user, not globally.

**Cards table**: simple Q&A plus `aiStatus` lifecycle and an integer `version` used for optimistic concurrency on edits, confirmation, and AI follow-up commits.

**AI jobs table**: durable, user-scoped Card/Quiz generation commands. Inputs are AES-GCM encrypted; queue messages contain only `jobId`. Idempotency, active-resource deduplication, leases, attempts, results, errors, and terminal state are persisted. A partial unique index allows only one `running` job per user.

**Agent tables**: Study Coach conversations are user-owned sessions. Each turn creates an idempotent run with its own page/problem context, model identity, status, usage, messages, and ordered tool steps. A session is not permanently bound to one problem, so it can continue across the web app. Only one run may be active per session; stale runs are failed on snapshot/begin-turn recovery.

**Quiz sessions table**: per-problem review quiz sessions with `status` (`active | completed | archived`), `itemsJson` (5 generated quiz items with source + scope), `answersJson`, `score`, timestamps, and cascade delete through `problemId`.

**Settings table**: per-user key/value store keyed by `(userId, key)`. AI settings include provider/model plus an AES-GCM encrypted API key envelope; API responses expose only `hasApiKey`, never the raw key.

### `packages/core` - Shared business logic

- `fsrs.ts`: wraps `ts-fsrs` - `rate()` computes next review for one rating, `preview()` returns all 4 rating outcomes at once via `repeat()`, `retrievability()` returns 1 for new cards, `emptyCardState()`
- `types.ts`: shared TypeScript types (`LeetCodeDifficulty`, `AiProvider`, `FsrsRating`)
- `quiz-format.ts`: small Markdown formatter that wraps complexity expressions, DP states, and code-like variables in inline code before rendering quiz text.

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
  - `capture/` - extension hits this to upsert problems + submissions. Idempotent by `leetcodeSlug`, stores `leetcodeId` when present, and seeds FSRS state for new problems.
  - `problems/` - list problems with card counts. Supports `?search=` for title search.
  - `problems/[id]/` - PATCH notes (`{ notes }`) for autosave from review.
  - `problems/by-slug/[slug]/` - extension lookup by LeetCode slug. Returns problem, ready cards, candidates, FSRS previews, and queue state.
  - `problems/[id]/user-card/` - POST saves a manual card directly as `ready` (just `question` + `answer`).
  - `ai-jobs/` - POST creates an idempotent asynchronous Card/Quiz generation job and publishes `{ jobId }` to Vercel Queues; GET lists user-owned jobs for a problem.
  - `ai-jobs/[id]/` - GET polls one user-owned job; DELETE requests cancellation.
  - `queues/ai-generation/` - Vercel Queue consumer. Claims a lease, runs the generator, and commits the business result plus terminal job state atomically.
  - `agent/sessions/` and `agent/sessions/[id]/` - list active Study Coach sessions and load one persistent session snapshot.
  - `agent/turns/` - starts/resumes a ToolLoopAgent turn and streams newline-delimited Agent events. Request disconnect aborts the model call; stale runs recover as failed.
  - `agent/steps/[id]/approve/` and `dismiss/` - resolve user-confirmed Card/Quiz proposals. Navigation and read tools do not require approval.
  - `problems/[id]/ai-cards/` - GET returns candidate/failed candidates. AI generation does not run through this route.
  - `problems/[id]/quiz/` - GET current non-archived quiz session; DELETE resets quiz history. AI generation does not run through this route.
  - `problems/[id]/quiz/[sessionId]/` - PATCH one quiz answer. Repeated answers return 400; the fifth answer completes the session and computes score.
  - `problems/[id]/quiz/[sessionId]/save-card/` - POST `{ itemId }` to save a quiz item directly as a `ready` card and record a `card_created` event.
  - `cards/` - DELETE one or more cards by id.
  - `cards/[id]/` - PATCH edits question/answer or confirms a candidate card (`aiStatus: "ready"`).
  - `review/next/` - returns next due problem with FSRS previews (via `preview()`), ready cards, submissions, and notes. A due problem does not need ready cards because Quiz can start review.
  - `review/queue/` - returns today's due queue for the extension Today tab.
  - `review/rate/` - records recall self-rating + applies FSRS scheduling to the problem. Notes written to `problems.notes`.
  - `settings/` - session-only GET/POST AI provider/model/encrypted key + daily review limit. No prompt customization.
- **`src/proxy.ts`**: lightweight auth gate and credentialed Chrome-extension CORS preflight handler (Next 16's `proxy` file convention; replaces the old `middleware.ts`). Web pages and extension API requests require the same Better Auth session cookie; API routes and server pages must still call the auth helpers above before touching data.
- **`src/server/`**: all DB, auth, settings, queue, AI, prompt, query, and transactional command implementations. Pages call server query functions directly; API routes stay as thin HTTP adapters.
  - `ai.ts`: loads AI provider/model from DB and builds the AI SDK language model. DeepSeek has custom fetch to disable thinking mode. Throws clear error if AI is not configured.
  - `agent/`: persistent Study Coach store, ToolLoopAgent runtime, page/problem-aware tools, proposal steps, and quiz-context privacy rules.
  - `card-prompt.ts`: builds A/B/C context (problem context / submissions / raw text) and single-draft prompts. Prompt returns only `{question, answer}` and encourages Markdown.
  - `quiz-prompt.ts`: builds Chinese 5-question quiz prompts from problem title/difficulty/slug/tags/statement, notes, ready cards, recent submissions, failed submission details, and recent completed quiz history. Prompts require scoped items and at least one complexity question.
  - `due-problems.ts`: shared due condition (`not archived` and `fsrs_due <= now` or null).
  - `review-queue.ts`: computes due count, done-today, remaining within daily limit.
  - `settings.ts`: reads/writes per-user AI and review settings to the `settings` k/v table. Default review limit 20; AI defaults to empty, and user API keys are AES-GCM encrypted with `AI_KEY_ENCRYPTION_SECRET`. Server env provider keys are intentionally not used as runtime fallbacks.
- **`src/lib/`**: browser-safe UI helpers only (auth client, i18n, autosave, hooks, URL/format utilities). It must not import DB or server modules.
- **Pages**:
  - `/` - static public landing page; authenticated sessions redirect to `/today`
  - `/today` - authenticated home: due queue, progress, daily stats
  - `/review` - dynamic sibling panels for Question, Quiz/Cards/Submissions/Notes, and optional Study Coach; panels can be hidden and resized
  - `/problems` - list with difficulty/state/tag/search filters
  - `/problems/[id]` - problem detail: metadata, notes, cards, submission code, review history timeline
  - `/analysis` - FSRS dashboard: memory score, lapse rate, state/stability distributions, risk table, reviews/day chart, burden forecast, dev reset
  - `/settings` - AI provider configuration + daily review limit

### `apps/extension` - Chrome MV3 Extension

- **Content script** (`content/leetcode.ts`): scrapes LeetCode problem pages via their GraphQL endpoint - fetches problem metadata, recent submissions, and submission details (code, status, failures). Falls back from `questionSubmissionList` to legacy `submissionList`.
- **Background** (`background/index.ts`): minimal service worker, satisfies MV3 lifecycle.
- **Popup** (`popup/`):
  - Top nav: `Today`, `Problem`, `Settings`.
  - Theme control: `System`, `Light`, `Dark`.
  - `Problem` has compact `Review` / `Manage` modes.
  - `Review` contains `Quiz`, `Card`, and `Notes` sub-tabs. Quiz generation creates a durable job and polls it; reopening the popup resumes from the server job state. Completed quizzes can create a new batch and bulk-create cards for missed items.
  - `Manage` contains manual card creation, asynchronous AI candidate generation/follow-up/confirm/discard, and existing card management.
  - `Settings` stores user preferences. The API origin is fixed at build time;
    legacy saved API URLs are retired. Test connection calls `/api/me` with the
    shared web session and shows the signed-in email.
  - Markdown rendering is used for card answers, quiz text, explanations, and notes; code stays mono and regular UI stays sans.
- **Design**: CSS variables match the web app (gold accent, same bg/surface/fg colors), custom reusable scrollbars, and shared typography rules.

## Data Flow

### Capture (extension)

1. Open a LeetCode problem page and click the extension popup.
2. The extension sends credentialed requests to the exact API origin; Chrome includes the existing Better Auth web-session cookie.
3. If the problem is unknown, "Capture this problem" reads page data via the content script and POSTs to `/api/capture`.
4. If the problem is known, the popup shows Review/Manage with the current FSRS due state, ready cards, candidates, submissions, notes, and quiz session.

### Card creation

**Manual**: Write question + answer directly -> POST `/api/problems/:id/user-card` -> saved as `ready`.

**AI**: Click Auto generate or write raw text -> POST `/api/ai-jobs` with a `card_generate` command -> poll `/api/ai-jobs/:id`. The queue worker inserts one `candidate` card on success. Follow-up is another version-guarded job; Confirm uses a version-guarded card PATCH; Discard deletes the candidate.

There is no AI-card batch generation, `polish`, or `generating` card status. Job lifecycle lives only in `ai_jobs`; card lifecycle remains `candidate | failed | ready`.

### Quiz review

1. `GET /api/problems/:id/quiz` returns the current active/completed quiz session or `null`.
2. `POST /api/ai-jobs` creates a quiz generation command. The queue worker generates exactly 5 single-choice questions in the configured generation language. Each item has a source and scope. AI failure writes no quiz session.
3. Answering a choice PATCHes `/api/problems/:id/quiz/:sessionId` immediately. The API stores correctness and returns the explanation.
4. After 5 answers, the session becomes `completed`; score maps to suggested rating: `0-1 Again`, `2 Hard`, `3-4 Good`, `5 Easy`.
5. Suggested rating is only guidance. FSRS is still updated only by manual rating.
6. `Regenerate` archives existing non-archived sessions and creates a new active session.
7. `New batch` is available only after completion. It archives the completed session, passes recent completed quiz history into the prompt, and creates a new active session without repeating prior questions.
8. `Save as card` writes a ready card directly from quiz question + correct answer + explanation. Completed summaries can bulk-create cards for missed items.

### Review session

1. `GET /api/review/next` returns the next due problem with FSRS previews, ready cards, submissions, and notes.
2. User reviews Quiz/Cards/Submissions/Notes, then self-rates recall (Again/Hard/Good/Easy).
3. `POST /api/review/rate` records the rating and applies FSRS scheduling. Notes are saved to `problems.notes`.
4. Meaningful interactions write to `review_events`.

### Study Coach session

1. `AgentShell` lives in the authenticated app layout, so Coach can open from any web page as a sibling right panel rather than an overlay.
2. The UI lists only persisted non-empty sessions; a new session row is created by the first submitted message, not by repeatedly clicking New session.
3. `POST /api/agent/turns` stores the run context and user message, then `ToolLoopAgent` iterates over read, navigation, and proposal tools while streaming events.
4. Page/problem context belongs to the run. Continuing the same session after navigation uses the new run's context without rewriting prior context.
5. Read tools execute immediately. Navigation emits an executable destination. Card/Quiz writes are proposals and require explicit approval before creating an AI job.
6. Assistant output, tool steps, terminal status, usage, and resumable model messages are persisted. Disconnect/timeout/failure never leaves an indefinitely running session.

## Key Design Decisions

- **Multi-user deployment**: public Better Auth Google OAuth and per-user data isolation across all business tables.
- **Extension auth reuses the web session**: no separate ankify token is created, copied, or stored; signed-out users continue with Google in a web tab.
- **User-owned AI keys**: server env provider keys are not runtime fallbacks. Users save provider/model/key in Settings, and keys are encrypted before storage.
- **Problem-level scheduling**: FSRS state lives directly on the `problems` row. Cards and quizzes support recall, but only the problem gets scheduled.
- **Cards are simple**: `question`, `answer`, lifecycle fields only. No explanation/rationale/source fields on the card row.
- **AI card generation is user-gated**: AI card generation creates `candidate`; only confirmed cards become `ready`.
- **Quiz save-as-card is direct**: quiz items are already answered/reviewed by the user, so saving one creates a `ready` card immediately.
- **Candidate/failed cards excluded from review**: only `aiStatus='ready'` cards are served as review cards.
- **AI generation is asynchronous**: Vercel Queues provides at-least-once delivery; `ai_jobs` leases, idempotency keys, resource CAS checks, and atomic result/job commits provide application-level correctness.
- **Per-user execution is serialized**: the database permits only one running AI job per user; other queued jobs are retried later.
- **Agent sessions are cross-page, not per-problem**: sessions hold conversation history while each run snapshots the current page and optional problem focus.
- **Agent writes are user-gated**: Coach may read and navigate directly, but Card/Quiz generation is recorded as a proposal and starts only after explicit approval.
- **Quiz batches are scoped**: each item carries `source` and `scope`; generated batches must cover at least 4 scopes and include complexity.
- **`review_events` is append-only**: snapshots of stability, difficulty, retrievability, and metadata are kept for dashboards/history.
- **FSRS scheduler recomputes elapsed_days** from `last_review` and `now` in `init()` - stored `elapsed_days` is never trusted.
- **AI defaults to empty**: provider/model/key must be configured before AI generation; errors should be clear.

## UI Conventions

The web app and the extension popup share one typographic language. **Default everywhere is sans (`system-ui` stack); mono is a marked notation, not a default.**

**Use sans (do nothing - it's the default):**
- All prose, labels, buttons, headings, nav tabs, pills, hero titles, table cells, list items.
- Numeric columns and counters. **For digit alignment, use Tailwind `tabular-nums` (CSS `font-variant-numeric: tabular-nums`) - not `font-mono`.** Sans + `tabular-nums` aligns digits without flipping fonts.

**Use mono (Tailwind `font-mono` in web; `var(--font-mono)` in extension popup CSS) only for:**
1. Real code: `<pre>` blocks and inline `<code>` rendered by Markdown components, submission code displays.
2. Shell commands and env-path tokens inside copy: `<code>pnpm db:migrate</code>`, `<code>.env.local</code>`.
3. Identifier-shaped inputs: API key and model id. Slug displays (`two-sum`).
4. Programming-language labels rendered next to code (`python`, `cpp`).

Anything else in `font-mono` is a bug - it splits the visual register and looks terminal-ish against the rest of the app.

**Extension popup CSS (`apps/extension/src/popup/popup.css`)** declares two font variables on `:root`:
- `--font-ui` - sans stack, the popup's default. Used by topbar, tabs, hero, pills, buttons, list items, today-stats, etc.
- `--font-mono` - mono stack. Used only by code, slug chips, and settings inputs for API URL/token.

If a new component needs a mono look, justify it against the four cases above; otherwise use the variable's default.

**Editor to rendered-markdown parity.** Where a textarea coexists with a Markdown view of the same content, the textarea must use the same font/size/leading as the rendered output so the visual transition is invisible. Do not apply `font-mono` to such textareas - Markdown's own `<pre>`/`<code>` styles switch to mono locally.

## Terminology

- **problem** = a LeetCode problem stored in `problems`; the unit FSRS schedules.
- **card** = a flashcard with `question` (front) and `answer` (back).
- **candidate** = an AI-generated card draft, not yet confirmed.
- **quiz session** = a per-problem set of 5 multiple-choice questions plus user answers and score.
- **retrievability** = probability the user still remembers (0-1), computed by FSRS.
- **stability** = how well a memory is consolidated (days until retrievability drops to 90%).
