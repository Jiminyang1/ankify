# ankify

Personal LeetCode-first spaced-repetition app. FSRS-6 scheduling, AI-generated multiple-choice questions to verify understanding, Chrome extension for fast capture, web dashboard for review and stats.

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

## Status

V1 in active build — see todo list in current Claude session.