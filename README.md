# ankify

Personal LeetCode-first spaced-repetition app. It captures problems and submissions from LeetCode, reviews them with FSRS-6 scheduling, and supports both long-lived flashcards and per-review AI quizzes.

## Stack

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces |
| Web + API | Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui |
| DB | Turso / libSQL / SQLite + Drizzle ORM |
| Spaced repetition | [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) FSRS-6 |
| AI | Vercel AI SDK with Claude, OpenAI, or DeepSeek selected in settings |
| Extension | Chrome MV3 + Vite + React |

## Layout

```text
apps/
  web/          Next.js dashboard, API, review UI
  extension/    Chrome extension for LeetCode capture and quick review
packages/
  db/           Drizzle schema, migrations, libSQL client
  core/         FSRS wrapper, shared schemas and types
```

## Quick Start

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
pnpm dev:ext
```

Fill `.env.local` with either Turso credentials or `LOCAL_DB_PATH`, Better Auth/Google OAuth credentials, an email allowlist, and `AI_KEY_ENCRYPTION_SECRET`. AI provider keys are saved per user in Settings and are not read from server env vars.

## Product Flow

1. Open a LeetCode problem and use the Chrome extension to capture the problem, metadata, recent submissions, submission code, and failure details.
2. Review due problems in `/review`. FSRS scheduling is problem-level, not card-level.
3. Use the right workspace tabs:
   - `Quiz`: generate a 5-question Chinese multiple-choice quiz from statement, notes, cards, recent submissions, and recent quiz history.
   - `Cards`: review saved flashcards.
   - `Submissions`: inspect captured code and failures.
   - `Notes`: edit Markdown notes, autosaved to the problem.
4. Rate the problem manually with Again / Hard / Good / Easy. Quiz score only suggests a rating; it does not write FSRS automatically.

## Cards and Quiz

Cards are long-term memory assets with only `question` and `answer`.

- Manual cards are saved directly as `ready`.
- AI card generation is synchronous and single-card only. `Auto generate` and `Generate from note` create one `candidate`; follow-up rewrites that candidate. The user confirms it to `ready`.
- AI-card batch generation, background card generation, polling, `polish`, and `generating` card status are intentionally removed.
- Quiz sessions are per-problem review sessions. A generated quiz has exactly 5 single-choice items, each with 4 choices, one correct answer, explanation, source, and scope.
- Quiz scopes are `approach`, `invariant`, `edge_case`, `complexity`, `implementation`, and `mistake_review`; each batch must cover at least 4 scopes and include a complexity item.
- After completing a quiz, `New batch` archives the completed session and generates a fresh active session using recent completed quizzes to avoid repeats.
- Saving a quiz item as a card writes a `ready` card immediately and records a `card_created` review event.

## Database

Main tables:

- `problems`: LeetCode problem metadata, notes, archived flag, and FSRS state.
- `submissions`: captured accepted and failed submissions.
- `cards`: flashcards and AI candidates, with `ai_status` limited to `candidate | failed | ready`.
- `quiz_sessions`: active/completed/archived quiz JSON plus scoped items, answers, and score.
- `review_events`: append-only event log for captures, card creation, imports, and review ratings.
- `settings`: per-user key/value settings.

After schema changes:

```bash
pnpm db:generate
pnpm db:migrate
```

## Personal Vercel Deploy

Use Turso for production data. Do not deploy with local SQLite on Vercel.

1. Create a Turso database and token.
2. Add these Vercel environment variables for Production and Preview:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `BETTER_AUTH_SECRET`
   - `BETTER_AUTH_URL`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `ANKIFY_ALLOWED_EMAILS`
   - `AI_KEY_ENCRYPTION_SECRET`
3. Run migrations against Turso from your machine:
   ```bash
   pnpm db:migrate
   ```
4. In Vercel, import the repo as a monorepo project with root directory `apps/web`.
5. Use build command `pnpm build` and install command `pnpm install --frozen-lockfile`.
6. Configure Google Cloud OAuth redirect URIs:
   - local: `http://localhost:3000/api/auth/callback/google`
   - production: `https://your-domain.com/api/auth/callback/google`
7. After deploy, open `/login` and sign in with an allowlisted Google email.
8. In web Settings, save your AI provider/model/API key, then generate an extension API token.
9. In the Chrome extension settings, set API Base URL to your Vercel URL, paste the generated token, and use Test connection.

The web UI uses Better Auth Google sessions. The extension does not perform Google OAuth; it sends the per-user API token as `x-ankify-token`.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm build
```
