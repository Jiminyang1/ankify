# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install                # install deps (pnpm workspaces)
cp .env.example .env.local  # fill in TURSO_*, AI keys, ANKIFY_API_TOKEN, APP_PASSWORD

pnpm db:generate            # drizzle-kit generate (after schema changes)
pnpm db:migrate             # apply migrations to local/remote Turso
pnpm db:studio              # drizzle-kit studio (browse DB in browser)

pnpm dev                    # Next.js web app on :3000
pnpm dev:ext                # Chrome extension build in watch mode

pnpm typecheck              # run tsc --noEmit across all packages
pnpm lint                   # run linter across all packages
pnpm build                  # production build across all packages
```

The root `scripts` in `package.json` delegate to workspace packages via pnpm filters (`--filter @ankify/web`, `--filter @ankify/extension`, `--filter @ankify/db`).

## Architecture

Monorepo with three layers:

### `packages/db` - Database layer

- Drizzle ORM schema in a single file: `src/schema.ts` (6 tables: `problems`, `submissions`, `cards`, `quiz_sessions`, `review_events`, `settings`)
- `client.ts` has a singleton `getDb()` that picks Turso remote or local SQLite based on env vars
- `migrate.ts` applies `drizzle/` migrations; run via `pnpm db:migrate`
- Schema infer types are re-exported (e.g. `Problem`, `Card`, `QuizSession`, `ReviewEvent`, etc.)

**Cards table** (8 columns): `id`, `problemId`, `question` (front), `answer` (back), `aiStatus` (candidate/failed/ready), `errorMessage`, `createdAt`, `updatedAt`. No extra metadata - just Q&A with lifecycle tracking.

**Quiz sessions table**: per-problem review quiz sessions with `status` (`active | completed | archived`), `itemsJson` (5 generated quiz items with source + scope), `answersJson`, `score`, timestamps, and cascade delete through `problemId`.

### `packages/core` - Shared business logic

- `fsrs.ts`: wraps `ts-fsrs` - `rate()` computes next review for one rating, `preview()` returns all 4 rating outcomes at once via `repeat()`, `retrievability()` returns 1 for new cards, `emptyCardState()`
- `types.ts`: shared TypeScript types (`LeetCodeDifficulty`, `AiProvider`, `FsrsRating`)
- `schemas.ts`: Zod schemas for capture, card drafts, synchronous AI card generation/follow-up, manual cards, card updates, review rating, quiz generation (`generate | regenerate | nextBatch`), quiz answers, scoped quiz items, and quiz save-as-card
- `quiz-format.ts`: small Markdown formatter that wraps complexity expressions, DP states, and code-like variables in inline code before rendering quiz text.

### `apps/web` - Next.js 15 App Router

- **API routes** under `src/app/api/`:
  - `capture/` - extension hits this to upsert problems + submissions. Idempotent by `leetcodeSlug`, stores `leetcodeId` when present, and seeds FSRS state for new problems.
  - `problems/` - list problems with card counts. Supports `?search=` for title search.
  - `problems/[id]/` - PATCH notes (`{ notes }`) for autosave from review.
  - `problems/by-slug/[slug]/` - extension lookup by LeetCode slug. Returns problem, ready cards, candidates, FSRS previews, and queue state.
  - `problems/[id]/user-card/` - POST saves a manual card directly as `ready` (just `question` + `answer`).
  - `problems/[id]/ai-cards/` - GET returns candidate/failed candidates. POST synchronously runs AI for `single/generate` (auto or from rawText) or `single/followup` with instruction. AI produces `candidate` drafts; user confirms to `ready`.
  - `problems/[id]/quiz/` - GET current non-archived quiz session; POST `{ action: "generate" | "regenerate" | "nextBatch" }`. `nextBatch` requires the current session to be completed, archives existing non-archived sessions, and uses recent completed quiz history for prompt context.
  - `problems/[id]/quiz/[sessionId]/` - PATCH one quiz answer. Repeated answers return 400; the fifth answer completes the session and computes score.
  - `problems/[id]/quiz/[sessionId]/save-card/` - POST `{ itemId }` to save a quiz item directly as a `ready` card and record a `card_created` event.
  - `cards/` - DELETE one or more cards by id.
  - `cards/[id]/` - PATCH edits question/answer or confirms a candidate card (`aiStatus: "ready"`).
  - `review/next/` - returns next due problem with FSRS previews (via `preview()`), ready cards, submissions, and notes. A due problem does not need ready cards because Quiz can start review.
  - `review/rate/` - records recall self-rating + applies FSRS scheduling to the problem. Notes written to `problems.notes`.
  - `settings/` - GET/POST AI provider/model/key + daily review limit. No prompt customization.
- **`src/middleware.ts`**: single-user auth gate. Web UI requires a signed `APP_PASSWORD` session cookie; extension/API automation can use `x-ankify-token` matching `ANKIFY_API_TOKEN`. Fail-closed in production when required secrets are missing.
- **`src/lib/`**:
  - `ai.ts`: loads AI provider/model from DB, builds `LanguageModelV1`. DeepSeek has custom fetch to disable thinking mode. Throws clear error if AI is not configured.
  - `card-prompt.ts`: builds A/B/C context (problem context / submissions / raw text) and single-draft prompts. Prompt returns only `{question, answer}` and encourages Markdown.
  - `quiz-prompt.ts`: builds Chinese 5-question quiz prompts from problem title/difficulty/slug/tags/statement, notes, ready cards, recent submissions, failed submission details, and recent completed quiz history. Prompts require scoped items and at least one complexity question.
  - `due-problems.ts`: shared due condition (`not archived` and `fsrs_due <= now` or null).
  - `review-queue.ts`: computes due count, done-today, remaining within daily limit.
  - `settings.ts`: reads/writes AI and review settings to the `settings` k/v table. Default review limit 20; AI defaults to empty.
- **Pages**:
  - `/` - home: due queue, progress, daily stats
  - `/review` - left statement/rating panel plus right workspace tabs: Quiz, Cards, Submissions, Notes
  - `/problems` - list with difficulty/state/tag/search filters
  - `/problems/[id]` - problem detail: metadata, notes, cards, submission code, review history timeline
  - `/analysis` - FSRS dashboard: memory score, lapse rate, state/stability distributions, risk table, reviews/day chart, burden forecast, dev reset
  - `/settings` - AI provider configuration + daily review limit

### `apps/extension` - Chrome MV3 Extension

- **Content script** (`content/leetcode.ts`): scrapes LeetCode problem pages via their GraphQL endpoint - fetches problem metadata, recent submissions, and submission details (code, status, failures). Falls back from `questionSubmissionList` to legacy `submissionList`.
- **Background** (`background/index.ts`): minimal service worker, satisfies MV3 lifecycle.
- **Popup** (`popup/`):
  - Top nav: `Today`, `This Problem`, `Settings`.
  - Theme control: `System`, `Light`, `Dark`.
  - `This Problem` has compact `Review` / `Manage` modes.
  - `Review` contains `Quiz`, `Card`, and `Notes` sub-tabs. Quiz generation is synchronous; if the user switches tabs while generation is pending, the Quiz tab shows pending state until the session appears. Completed quizzes can create a new batch and bulk-create cards for missed items.
  - `Manage` contains manual card creation, synchronous AI candidate generation/follow-up/confirm/discard, pending-state preservation for in-flight AI calls, and existing card management.
  - Markdown rendering is used for card answers, quiz text, explanations, and notes; code stays mono and regular UI stays sans.
- **Design**: CSS variables match the web app (gold accent, same bg/surface/fg colors), custom reusable scrollbars, and shared typography rules.

## Data Flow

### Capture (extension)

1. Open a LeetCode problem page and click the extension popup.
2. If the problem is unknown, "Capture this problem" reads page data via the content script and POSTs to `/api/capture`.
3. If the problem is known, the popup shows Review/Manage with the current FSRS due state, ready cards, candidates, submissions, notes, and quiz session.

### Card creation

**Manual**: Write question + answer directly -> POST `/api/problems/:id/user-card` -> saved as `ready`.

**AI**: Click Auto generate or write raw text -> POST `/api/problems/:id/ai-cards` with `{ mode: "single", action: "generate", rawText? }`. The request waits for AI and inserts one `candidate` card only on success. User can edit, Follow-up (rewrite with instruction), Confirm (PATCH `aiStatus: "ready"`), or Discard (DELETE).

There is no AI-card batch generation, background card generation, polling, `polish`, or `generating` card status. Historical `generating` rows are removed by migration.

### Quiz review

1. `GET /api/problems/:id/quiz` returns the current active/completed quiz session or `null`.
2. `POST /api/problems/:id/quiz` generates exactly 5 Simplified Chinese single-choice questions. Each item has a source and scope. AI failure returns an error and writes no DB rows.
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

## Key Design Decisions

- **Single-user V1**: password-gated web UI, token-gated extension API; `settings` table is a k/v store.
- **Problem-level scheduling**: FSRS state lives directly on the `problems` row. Cards and quizzes support recall, but only the problem gets scheduled.
- **Cards are simple**: `question`, `answer`, lifecycle fields only. No explanation/rationale/source fields on the card row.
- **AI card generation is user-gated**: AI card generation creates `candidate`; only confirmed cards become `ready`.
- **Quiz save-as-card is direct**: quiz items are already answered/reviewed by the user, so saving one creates a `ready` card immediately.
- **Candidate/failed cards excluded from review**: only `aiStatus='ready'` cards are served as review cards.
- **Quiz is synchronous V1**: no background jobs. Pending is UI state while the foreground request runs.
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
3. Identifier-shaped inputs: API key, model id, API base URL, API token. Slug displays (`two-sum`).
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
