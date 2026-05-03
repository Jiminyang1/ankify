# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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

### `packages/db` — Database layer

- Drizzle ORM schema in a single file: `src/schema.ts` (5 tables: `problems`, `submissions`, `cards`, `review_events`, `settings`)
- `client.ts` has a singleton `getDb()` that picks Turso remote or local SQLite based on env vars
- `migrate.ts` applies `drizzle/` migrations; run via `pnpm db:migrate`
- Schema infer types are re-exported (e.g. `Problem`, `Card`, `ReviewEvent`, etc.)

**Cards table** (7 columns): `id`, `problemId`, `question` (front), `answer` (back), `aiStatus` (generating/candidate/failed/ready), `errorMessage`, `createdAt`. No extra metadata — just Q&A with lifecycle tracking.

### `packages/core` — Shared business logic

- `fsrs.ts`: wraps `ts-fsrs` — `rate()` computes next review for one rating, `preview()` returns all 4 rating outcomes at once via `repeat()`, `retrievability()` (returns 1 for new cards), `emptyCardState()`
- `types.ts`: shared TypeScript types (`LeetCodeDifficulty`, `AiProvider`, `FsrsRating`)
- `schemas.ts`: Zod schemas — `captureProblemSchema`, `cardDraftSchema` (just `{question, answer}`), `aiCardsRequestSchema` (single/batch generate), `userCardManualCreateSchema`, `updateCardPatchSchema`, `reviewRatingSchema`

### `apps/web` — Next.js 15 App Router

- **API routes** under `src/app/api/`:
  - `capture/` — extension hits this to upsert problems + submissions (idempotent by `leetcodeSlug`). Seeds FSRS state for new problems.
  - `problems/` — list problems with card counts. Supports `?search=` for title search.
  - `problems/by-slug/[slug]/` — extension lookup by LeetCode slug. Returns problem, ready cards, and generating/candidate/failed candidates.
  - `problems/[id]/user-card/` — POST saves a manual card directly as `ready` (just `question` + `answer`). No AI path.
  - `problems/[id]/ai-cards/` — GET returns generating/candidate/failed candidates. POST triggers AI: `single/generate` from rawText, `single/polish` to refine, `single/followup` with instruction, or `batch` generation. AI produces `candidate` drafts; user confirms to `ready`. Recovers stuck generating cards on GET (10-min timeout → `failed`).
  - `cards/` — DELETE one or more cards by id.
  - `cards/[id]/` — PATCH edits question/answer or confirms a candidate card (`aiStatus: "ready"`).
  - `review/next/` — returns next due problem with FSRS previews (via `preview()`) + ready cards. Limited by daily review quota.
  - `review/rate/` — records recall self-rating + applies FSRS scheduling to the problem. Notes written to `problems.notes`.
  - `settings/` — GET/POST AI provider/model/key + daily review limit. No prompt customization.
- **`src/middleware.ts`**: single-user auth gate. Web UI requires a signed `APP_PASSWORD` session cookie; extension/API automation can use `x-ankify-token` matching `ANKIFY_API_TOKEN`. Fail-closed in production when required secrets are missing.
- **`src/lib/`**:
  - `ai.ts`: loads AI provider/model from DB, builds `LanguageModelV1`. DeepSeek has custom fetch to disable thinking mode. Throws clear error if AI not configured (provider/model empty).
  - `card-prompt.ts`: builds A/B/C context (problem context / submissions / raw text) and single-draft or batch prompts. Prompt returns only `{question, answer}`.
  - `review-queue.ts`: computes due count, done-today, remaining within daily limit.
  - `settings.ts`: reads/writes AI and review settings to the `settings` k/v table. Default review limit 20; AI defaults to empty (must configure before use).
- **Pages**:
  - `/` — home: due queue, progress, daily stats
  - `/review` — flashcard flip + self-rating (Again/Hard/Good/Easy)
  - `/problems` — list with difficulty/state/tag/search filters
  - `/problems/[id]` — problem detail: metadata, cards, submission code, review history timeline
  - `/analysis` — FSRS dashboard: memory score, lapse rate, state/stability distributions, risk table, reviews/day chart, burden forecast
  - `/settings` — AI provider configuration + daily review limit

### `apps/extension` — Chrome MV3 Extension

- **Content script** (`content/leetcode.ts`): scrapes LeetCode problem pages via their GraphQL endpoint — fetches problem metadata, recent submissions, and submission details (code, status, failures). Falls back from `questionSubmissionList` to legacy `submissionList`.
- **Background** (`background/index.ts`): minimal service worker, satisfies MV3 lifecycle.
- **Popup** (`popup/`): three tabs — Overview, Cards, Settings.
  - **Overview**: problem header + card composer with Manual/AI mode toggle. Manual = Q&A + save. AI = raw text → generate, then candidate appears inline with edit/Polish/Follow-up/Confirm/Discard. Auto-polls while generating.
  - **Cards**: list server cards (expandable Q&A) with delete.
  - **Settings**: API base URL + token.
- **Design**: CSS variables match web app (gold accent, same bg/surface/fg colors). Dark/light via `prefers-color-scheme`.

### Data flow

#### Capture (extension)

1. Open a LC problem page → click extension popup.
2. If problem unknown → "Capture this problem" reads page via content script, POSTs to `/api/capture`.
3. If problem known → popup shows Overview with card editor + existing cards.

#### Card creation — two modes

**Manual**: Write question + answer directly → POST `/api/problems/:id/user-card` → saved as `ready`.

**AI**: Write raw text → POST `/api/problems/:id/ai-cards` with `{mode:"single", action:"generate"}` → generating card inserted, AI runs in background, popup polls. AI returns `{question, answer}` → card becomes `candidate`. User can Polish (refine), Follow-up (rewrite with instruction), Confirm (PATCH `aiStatus:"ready"`), or Discard (DELETE).

Batch: click "Generate from history" → POST batch → N generating cards with placeholders → AI generates all from problem context + existing cards.

#### Review session

1. `GET /api/review/next` → next due problem + FSRS previews (all 4 ratings via `preview()`) + ready cards.
2. User flips through ready cards, writes notes, self-rates recall (Again/Hard/Good/Easy).
3. `POST /api/review/rate` → records rating + applies FSRS scheduling. Notes saved to `problems.notes`.
4. All steps write to `review_events`.

### Key design decisions

- **Single-user V1**: password-gated web UI, token-gated extension API; `settings` table is a k/v store.
- **FSRS state lives directly on the `problems` row** (no separate state table).
- **Cards are user-gated**: AI produces `candidate` drafts; only user-confirmed `ready` cards enter review. Batch generation from problem context is supported.
- **Cards have only question + answer**: no answerExplanation, rationale, targetKind/targetKey, rawText on the card. Raw text is API input, not stored.
- **AI structuring is async**: row inserted as `generating`, AI rewrites in background, UI polls.
- **Generating/candidate/failed cards excluded from review** — only `aiStatus='ready'` cards are served.
- **`review_events` is an append-only log** — snapshots of stability, difficulty, retrievability at review time.
- **FSRS scheduler recomputes elapsed_days** from `last_review` and `now` in `init()` — stored `elapsed_days` is never trusted. Safe even if reviews are delayed.
- **AI defaults to empty** — must configure provider/model in Settings before generating cards. Clear error if unconfigured.

### Terminology

- **problem** = a LeetCode problem stored in `problems`; the unit FSRS schedules.
- **card** = a flashcard with `question` (front) and `answer` (back). Always user-confirmed.
- **candidate** = an AI-generated card draft, not yet confirmed.
- **retrievability** = probability the user still remembers (0–1), computed by FSRS.
- **stability** = how well a memory is consolidated (days until retrievability drops to 90%).
