# ankify

LeetCode-first spaced-repetition app. ankify captures problems and submissions from LeetCode, turns them into review material, and schedules future reviews with FSRS-6.

It has two surfaces:

- A web app for daily review, problem history, quizzes, cards, notes, settings, and analytics.
- A Chrome extension that sits on LeetCode, captures the current problem, and lets you review the current problem without leaving the page.

## Features

- **Spaced repetition for LeetCode problems**: each problem has one FSRS state and comes back when it is due.
- **Review workspace**: statement, rating buttons, quiz, cards, submissions, and notes stay in one focused review screen.
- **AI quizzes**: generate 5-question multiple-choice quizzes from the problem statement, notes, cards, recent submissions, and previous quiz history.
- **Flashcards**: create manual cards, confirm AI-generated candidate cards, or save missed quiz items as ready cards.
- **Submission-aware review**: captured code and failed test details are stored with the problem, so review is tied to what you actually wrote.
- **Extension + web sync**: the extension uses a per-user API token from Web Settings and sends it as `x-ankify-token`.
- **Multi-user deployment**: Google Auth, email allowlist, per-user data isolation, and user-provided encrypted AI keys.

## Current Architecture

- **Auth**: Better Auth with Google OAuth. Production is fail-closed unless Google credentials, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ANKIFY_ALLOWED_EMAILS`, and `AI_KEY_ENCRYPTION_SECRET` are configured.
- **Users**: production signup is controlled by an email allowlist. Every business table is scoped by `userId`.
- **Data**: Turso/libSQL is the production database. Local SQLite is only a development fallback and is not used on Vercel.
- **AI keys**: users bring their own provider key. Keys are encrypted with `AI_KEY_ENCRYPTION_SECRET` before being stored; API responses only expose `hasApiKey`.
- **Extension auth**: the extension does not use Google OAuth. It stores an API base URL and a user API token generated in Web Settings, then calls API routes with `x-ankify-token`.
- **Scheduling**: FSRS state lives on the `problems` row. Cards and quizzes support recall, but only the problem is scheduled.

## Stack

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces |
| Web + API | Next.js 16 App Router + TypeScript + Tailwind + shadcn/ui |
| DB | Turso / libSQL + Drizzle ORM |
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
cp .env.example .env.local        # local dev profile (SQLite + localhost auth)
pnpm db:migrate                    # creates packages/db/local.db
pnpm dev                           # http://localhost:3000
pnpm dev:ext                       # extension watch build
```

Fill `.env.local` with Better Auth/Google OAuth credentials, an email allowlist, and `AI_KEY_ENCRYPTION_SECRET`. Leave `TURSO_*` empty so the app uses `LOCAL_DB_PATH`. AI provider keys are saved per user in Settings and are not read from server env vars.

## Environments

The repo ships two profiles. They live in **separate env files** and **separate scripts** so a `db:migrate` against local can never accidentally hit Turso, and vice versa.

| Profile | DB | Auth URL | Env file | Activated by |
| --- | --- | --- | --- | --- |
| `local` (default) | SQLite at `LOCAL_DB_PATH` | `http://localhost:3000` | `.env.local` | `pnpm dev`, `pnpm db:migrate`, `pnpm db:studio` |
| `production` | Turso (`TURSO_DATABASE_URL`) | your Vercel URL | `.env.production.local` | `pnpm db:migrate:prod`, `pnpm db:studio:prod` |

`pnpm dev` always runs against the local profile — production is served by Vercel using env vars from the Vercel dashboard, never from a file in this repo. The `:prod` scripts are the only paths that reach the production Turso DB and they require `.env.production.local` to be present. `AI_KEY_ENCRYPTION_SECRET` in that file MUST match the value set on Vercel; rotating it orphans every encrypted AI key in the prod DB.

```bash
# local (default profile)
pnpm db:migrate          # apply migrations to packages/db/local.db
pnpm db:studio           # browse local SQLite

# production (requires .env.production.local)
pnpm db:migrate:prod     # apply migrations to Turso
pnpm db:studio:prod      # browse prod Turso (read carefully)
```

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

- `user`, `session`, `account`, `verification`: Better Auth tables.
- `apikey`: Better Auth API-key plugin table for extension tokens.
- `problems`: LeetCode problem metadata, notes, archived flag, and FSRS state.
- `submissions`: captured accepted and failed submissions.
- `cards`: flashcards and AI candidates, with `ai_status` limited to `candidate | failed | ready`.
- `quiz_sessions`: active/completed/archived quiz JSON plus scoped items, answers, and score.
- `review_events`: append-only event log for captures, card creation, imports, and review ratings.
- `settings`: per-user key/value settings.

All user-owned business data includes `userId`. `problems.leetcodeSlug` and `leetcodeId` are unique per user, not globally.

After schema changes:

```bash
pnpm db:generate
pnpm db:migrate
```

## Vercel Deploy

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
