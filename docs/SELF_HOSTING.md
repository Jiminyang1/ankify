# Self-hosting and development

Everything you need to run ankify locally, test it against isolated fixtures,
or deploy your own instance. For the product overview, see the
[README](../README.md).

## Quick start (local dev, SQLite)

```bash
pnpm install
cp .env.example .env.local        # local profile (SQLite + localhost auth)
pnpm db:migrate                    # creates packages/db/local.db
pnpm dev                           # http://localhost:3000
pnpm dev:ext                       # extension dev server with HMR
```

Fill `.env.local` with Better Auth + Google OAuth credentials and `AI_KEY_ENCRYPTION_SECRET`. Leave `TURSO_*` empty so the app uses the local SQLite. AI provider keys are saved per-user from the Settings page, never read from server env vars.

Load the development extension from `apps/extension/dist/` (`chrome://extensions` → Developer mode → Load unpacked), sign into the web app with Google, and open the extension. Development mode targets `http://localhost:3000` automatically; the API origin is fixed at build time and is not user-editable. The extension detects the shared session automatically.

Use `pnpm dev:ext` while editing the extension so CRXJS can refresh extension pages and content scripts. After a production `pnpm build`, reload Ankify once in `chrome://extensions`, then refresh any already-open LeetCode tabs; production builds replace hashed content-script files.

## Reusable local QA environment

Use the QA profile for manual QA, browser automation, Agent testing, and
extension integration without Google OAuth or deployed infrastructure:

```bash
pnpm dev:qa       # reset fixtures, then start Web + the local AI Job worker
pnpm dev:qa:all   # same environment plus extension watch mode
pnpm qa:reset     # restore deterministic fixtures while preserving AI settings
```

For README and landing-page screenshots there is also an English demo deck
(24 problems with two months of review history) on the same QA database:

```bash
pnpm dev:demo     # load the demo deck, then start Web + the local AI Job worker
pnpm demo:reset   # reload the demo deck without starting servers
```

`pnpm qa:reset` switches back to the regular QA fixtures. Add `--keep-data` to
`pnpm dev:qa` or `pnpm dev:demo` to restart the servers without reseeding.

Open `http://localhost:3000/api/qa/login` to enter the fixed `qa@ankify.local`
account. Web and the extension then reuse the same Better Auth cookie. The QA
profile has its own `packages/db/qa.db`, auth secret, and encryption secret.

To make real model calls, create the gitignored `.env.qa.local` file:

```bash
ANKIFY_QA_AI_PROVIDER="openai"
ANKIFY_QA_AI_MODEL="gpt-5-mini"
ANKIFY_QA_AI_REASONING_MODE="fast"
ANKIFY_QA_AI_API_KEY="<provider-key>"
```

These may match Production's provider configuration, but QA never connects to
the Production database, Better Auth session store, or Queue. AI jobs remain
durable rows in the QA SQLite database and are processed by the local worker.
The worker tests application behavior; deployed Queue delivery/retry semantics
remain part of Preview/Production verification.

## Isolated local, Preview, and Production profiles

The repo separates local development, Vercel Preview, and Production so a local
command cannot silently fall back to or mutate a deployed database.

| Profile | DB | Auth URL | Env file | Used by |
| --- | --- | --- | --- | --- |
| `local` (default) | SQLite at `LOCAL_DB_PATH` | `http://localhost:3000` | `.env.local` | `pnpm dev`, `db:migrate`, `db:studio`, `db:generate` |
| `qa` | isolated SQLite at `packages/db/qa.db` | fixed local session | `.env.qa` + `.env.qa.local` | `pnpm dev:qa`, `pnpm dev:qa:all`, `pnpm qa:reset` |
| `preview` | dedicated Preview Turso DB | stable Preview branch domain | `.env.preview.local` | `db:migrate:preview`, `db:studio:preview` |
| `production` | Vercel-managed Turso integration (`database-ankify`) | `https://ankify-pi.vercel.app` | `.env.production.local` | `db:migrate:prod`, `db:studio:prod` |

`pnpm dev` always runs against `local`; `pnpm dev:qa` always runs against the
isolated QA database. Vercel reads its runtime variables from
the dashboard; the two deployed `.env.*.local` files are only for explicitly
running migrations from your laptop and must never be committed. Each
environment needs its own database, auth secret, and encryption secret.
`AI_KEY_ENCRYPTION_SECRET` must remain stable within one database; losing or
rotating it without re-encryption orphans every stored AI key.

## Deploy to Vercel

Use the Vercel Turso integration for production. The current Production database
is `database-ankify` in the `vercel-icfg-mdehlkeeqefnm8sqwfj1zlce`
organization. The personal `ankify-prod` database is legacy and is not used by
Vercel. See [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) before any Production
database operation.

1. Provision Turso through the Vercel integration. For the current deployment,
   retain the canonical `database-ankify` integration database and do not point
   `TURSO_*` at the legacy personal database.
2. Configure **Production** variables in Vercel:
   - `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
   - `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://ankify-pi.vercel.app`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `AI_KEY_ENCRYPTION_SECRET`
   - `ANKIFY_DEPLOYMENT_ENV=production`
   - `ANKIFY_EXTENSION_ORIGINS=chrome-extension://<extension-id>`
   - Public Google signup is on by default. `ANKIFY_DISABLE_SIGNUP=true` is an
     emergency kill switch for new accounts; existing users can still sign in.
3. Configure the same names under **Preview**, but use a separate Turso
   database, separate secrets, `ANKIFY_DEPLOYMENT_ENV=preview`, a stable Preview
   branch domain for `BETTER_AUTH_URL`, and normally
   `ANKIFY_DISABLE_SIGNUP=true`. Register that domain's Google callback URL if
   Preview login is required.
4. Before every deployment that contains a new migration, explicitly switch the
   Turso CLI to the integration organization, verify `database-ankify` and its
   current row/migration counts, then back up and migrate from one controlled
   terminal:
   ```bash
   pnpm db:release
   ```
   Preview migrations use `pnpm db:migrate:preview`. Database migrations never
   run inside a Vercel build: concurrent or retried builds must remain read-only
   with respect to schema. For breaking schema changes, use an
   expand/deploy/contract sequence.
5. Import the repo on Vercel with root directory `apps/web` and keep
   **Include source files outside the Root Directory** enabled. The committed
   `apps/web/vercel.json` pins the framework, frozen-lockfile install, validated
   build command, and Fluid compute. Node 22 and pnpm 10.25 are pinned in the
   root package metadata.
6. Add OAuth redirect URIs in Google Cloud Console:
   - local: `http://localhost:3000/api/auth/callback/google`
   - production: `https://ankify-pi.vercel.app/api/auth/callback/google`
   Set the Production OAuth audience to External, use the public root page as
   the app homepage, link `/privacy` and `/terms`, and verify the domain.
7. Sign in with any Google account and save your AI provider/model/key in Settings.
8. Build the Chrome extension with the canonical Production API origin below
   and click `Continue with Google`. An existing web login is detected automatically.

The web UI and Chrome extension use the same Better Auth Google session. The
extension sends credentialed requests only to the exact configured API origin;
it does not create or store a separate ankify API token.

Before uploading the extension to the Chrome Web Store, build it with the
Production API origin and use the public policy URL from the deployed web app:

```bash
ANKIFY_EXTENSION_API_ORIGIN=https://ankify-pi.vercel.app pnpm --filter @ankify/extension build
```

- Privacy policy: `https://ankify-pi.vercel.app/privacy`
- Terms: `https://ankify-pi.vercel.app/terms`
- The manifest asks for exact LeetCode and Production API hosts. The API origin
  is a build-time release setting; users cannot redirect the extension
  to a different server from Chrome storage.
- Users can export their data as NDJSON and permanently delete their account
  from Settings.

See [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) for Production identity and
database operations, and [`docs/RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)
for the complete Preview-to-Production checklist.

## Layout

```text
apps/
  web/          Next.js dashboard, API, review workspace, FSRS analysis
  extension/    Chrome MV3 extension for LeetCode capture and quick review
packages/
  db/           Drizzle schema, migrations, libSQL client, profile-aware loader
  core/         FSRS-6 wrapper, shared Zod schemas, AI generation contracts
```

## Tables

- `user`, `session`, `account`, `verification`: Better Auth.
- `problems`: LeetCode problem metadata, notes, archived flag, FSRS state.
- `submissions`: captured accepted and failed submissions.
- `cards`: flashcards and AI candidates (`ai_status`: `candidate | failed | ready`).
- `quiz_sessions`: active / completed / archived quiz JSON plus answers and score.
- `review_events`: append-only event log feeding the analysis dashboard.
- `settings`: per-user key/value settings (encrypted AI keys, daily review limit).

All user-owned business data carries `userId`. `problems.leetcodeSlug` and `leetcodeId` are unique per user, not globally.

After schema changes:
```bash
pnpm db:generate     # generate migration files
pnpm db:migrate      # apply locally
pnpm db:migrate:preview # apply to the isolated Preview Turso database
pnpm db:release      # back up Production, then apply Production migrations
```

## Verification

```bash
ANKIFY_EXTENSION_API_ORIGIN=https://ankify-pi.vercel.app pnpm release:check
```

This runs type checking, lint, tests, all Production builds, and fails on any
high/critical production dependency advisory. Production extension builds fail
closed when `ANKIFY_EXTENSION_API_ORIGIN` is omitted; development watch mode
continues to target `http://localhost:3000` automatically.
