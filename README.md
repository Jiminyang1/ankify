# ankify

Personal LeetCode-first spaced-repetition app. FSRS-6 scheduling, AI-assisted Q&A flashcards to verify understanding, Chrome extension for fast capture, web dashboard for review and stats.

## Stack


| Layer             | Choice                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| Monorepo          | pnpm workspaces                                                            |
| Web + API         | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui                |
| DB                | Turso (libSQL / cloud SQLite) + Drizzle ORM                                |
| Spaced repetition | `[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)` (FSRS-6)    |
| AI                | Vercel AI SDK — Claude / OpenAI / DeepSeek swappable in dashboard settings |
| Extension         | Chrome MV3 + Vite + React                                                  |


## Layout

```
apps/
  web/          Next.js dashboard + API + review UI
  extension/    Chrome extension (LeetCode capture + quick add)
packages/
  db/           Drizzle schema, migrations, libSQL client
  core/         FSRS wrapper, shared types
```

## Quick start (after deps installed)

```bash
pnpm install
cp .env.example .env.local        # fill in TURSO_*, AI provider keys
pnpm db:migrate
pnpm dev                          # web app on :3000
pnpm dev:ext                      # extension build watcher
```

## Personal Vercel deploy

Use Turso for production data. Do not deploy with local SQLite on Vercel.

1. Create a Turso database and token.
2. Add these Vercel environment variables for Production and Preview:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `ANKIFY_API_TOKEN`
   - `APP_PASSWORD`
   - one or more AI keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`
3. Run migrations against Turso from your machine:
   ```bash
   pnpm db:migrate
   ```
4. In Vercel, import the repo as a monorepo project with root directory `apps/web`.
5. Build command: `pnpm build`. Install command: `pnpm install --frozen-lockfile`.
6. After deploy, open `/login` and enter `APP_PASSWORD`.
7. In the Chrome extension settings, set API Base URL to your Vercel URL and API token to `ANKIFY_API_TOKEN`.

The web UI is protected by a signed `APP_PASSWORD` session cookie. The extension bypasses that cookie flow with `x-ankify-token`.

## Status

V1 in active build — see todo list in current Claude session.
