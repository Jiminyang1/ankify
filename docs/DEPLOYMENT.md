# Ankify deployment and production data

This is the canonical runbook for Ankify Production. Keep the README and
release checklist consistent with this file.

## Current Production identity

As of 2026-08-12, Production is:

| Resource | Canonical value |
| --- | --- |
| Web/API origin | `https://ankify-pi.vercel.app` |
| Vercel project | `ankify` (`apps/web` is the Root Directory) |
| Database provider | Turso, provisioned through the Vercel Turso integration |
| Turso organization | `vercel-icfg-mdehlkeeqefnm8sqwfj1zlce` |
| Turso database | `database-ankify` |
| Database URL | `libsql://database-ankify-vercel-icfg-mdehlkeeqefnm8sqwfj1zlce.aws-ap-northeast-1.turso.io` |
| Runtime DB variables | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` |

The personal Turso database named `ankify-prod` is a legacy database. It is
write-blocked and is **not** connected to Vercel Production. Never select a
database only because the Turso CLI's current organization lists a plausible
`*-prod` name.

`ANKIFY_NEW_DB_TURSO_DATABASE_URL` and
`ANKIFY_NEW_DB_TURSO_AUTH_TOKEN` are not read by the application. If these
legacy names still exist in Vercel, do not use them for migrations; the runtime
source of truth is the `TURSO_*` pair.

## Environment ownership

- Vercel Production owns the runtime `TURSO_*`, auth, encryption, extension
  origin, and deployment-profile variables.
- The Vercel Turso integration manages the long-lived Production database
  credential. Vercel Sensitive values cannot be treated as a portable local
  env file.
- `.env.production.local` is only for an operator running a controlled backup
  or migration. Use the exact integration database URL and a short-lived token
  created for `database-ankify`; do not copy credentials from the legacy
  personal database.
- `AI_KEY_ENCRYPTION_SECRET` must remain stable for the lifetime of this
  database. Provider API keys are user-owned encrypted settings, not Vercel env
  fallbacks.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (optional paid AI credits) are
  owned by Vercel Production and must be live-mode values there (Preview must
  use test mode; `scripts/check-vercel-env.mjs` and the runtime both refuse a
  mismatch). The webhook signing secret belongs to the Dashboard endpoint for
  `https://ankify-pi.vercel.app/api/billing/webhook`; rotating the endpoint
  requires updating the secret. Do not remove `ANKIFY_STARTER_AI_API_KEY`
  while users hold purchased credits: their balance runs on that key.
- Release order for schema changes (including the credit tables): back up and
  migrate first (`pnpm db:release`), then deploy the code that uses them.

## Identify the database before any write

Authenticate the Turso CLI, switch to the integration organization explicitly,
and verify the database name:

```bash
turso auth login
turso org switch vercel-icfg-mdehlkeeqefnm8sqwfj1zlce
turso db list
turso db show database-ankify
```

The list must contain `database-ankify` with the URL shown above. Then perform
read-only checks before creating a write token:

```bash
turso db shell database-ankify \
  "SELECT COUNT(*) AS migrations FROM __drizzle_migrations; \
   SELECT COUNT(*) AS users FROM user; \
   SELECT COUNT(*) AS problems FROM problems;"
```

Compare the migration count with the number of entries in
`packages/db/drizzle/meta/_journal.json`. User/problem counts should also be
consistent with the authenticated Production UI. A mismatch means stop and
resolve the target; do not migrate by name guessing.

## Back up and migrate

Create a short-lived token for the verified integration database and put it,
with the exact database URL, in the gitignored `.env.production.local`:

```bash
turso db tokens create database-ankify --expiration 1d
pnpm db:release
```

`pnpm db:release` first writes a SQLite backup under `backups/`, verifies its
foreign keys, and only then applies pending Drizzle migrations. Migrations do
not run during a Vercel build.

After migration, repeat the migration-count query and verify any newly required
tables and indexes. Keep the pre-migration backup until the release has passed
Production smoke testing.

## Deploy and verify

1. Run the release gate:

   ```bash
   ANKIFY_EXTENSION_API_ORIGIN=https://ankify-pi.vercel.app pnpm release:check
   ```

2. Push the reviewed commit to `main` and wait for the Vercel Production
   deployment to become `Ready` and for the canonical alias to point to it.
3. Verify public `/`, `/login`, `/privacy`, and `/terms` routes; an
   unauthenticated app page must redirect to `/login`, while `/api/me` returns
   `401`.
4. Sign in and verify `/today`, `/review`, `/problems`, and `/settings` against
   recognizable Production data. With the extension, start and finish a
   practice session on a LeetCode problem and check it in
   `GET /api/practice-sessions`.
5. Open Study Coach from a global page and a problem page. Verify session list,
   page-context updates, one ToolLoopAgent turn, a read-only tool call,
   streaming completion, and navigation. A valid provider/model/key must be
   saved in the current user's Production Settings before this test.
6. Verify the `ankify-ai-generation` Queue trigger exists, then run one queued
   Card or Quiz job through `queued -> running -> succeeded`.
7. If paid AI credits are enabled, check the Stripe Dashboard webhook endpoint
   shows recent `2xx` deliveries, and that `/settings#credits` lists the packs.
8. Inspect Vercel runtime logs and clean up any sessions or candidate content
   created only for smoke testing.

## Extension release

The Extension API origin is fixed at build time; users cannot redirect a
published build from Settings.

```bash
ANKIFY_EXTENSION_API_ORIGIN=https://ankify-pi.vercel.app \
  pnpm --filter @ankify/extension build
```

Confirm `apps/extension/dist/manifest.json` contains only the exact LeetCode and
Production API hosts and does not include the unpacked-development `key` field.
The unpacked build uses a stable development key and must not be uploaded to the
Chrome Web Store. `pnpm extension:check-manifest` enforces these rules.

### Extension-first release (0.3.0)

0.3.0 replaces the side panel with a toolbar popup and an in-page session
panel, and records practice sessions instead of capturing on demand. Its
permissions are `storage`, `tabs`, and `alarms` (new: wakes the worker to retry
queued sync and refresh the badge; Chrome shows no install warning for it);
`sidePanel` is gone. Order:

1. Apply migrations `0021_m1_practice_sessions` through `0025_m3_suggestions`
   (all additive; see the sections below) and deploy the web app. Both old
   (0.2.x) and new extensions work against it: capture, the legacy queue, and
   legacy ratings keep their shapes. The 0.3.0 panel and popup also call the
   session-analysis and suggestion routes, so this web deploy must precede
   the extension; either feature can then be switched off with
   `ANKIFY_DISABLED_WORKFLOWS`.
2. Publish 0.3.0 to the Chrome Web Store.
3. Cutover: once old extensions no longer matter, set
   `ANKIFY_DISABLED_WORKFLOWS=legacy_review` in Vercel and redeploy. Legacy
   `POST /api/review/rate` and `/undo` then answer `426 upgrade_required`, so
   an old client cannot schedule outside practice sessions, and
   `/api/capabilities` lists the deprecation. The web review page uses those
   routes until Phase 6B replaces it; do not retire them before that.

Rollback: remove a workflow from `ANKIFY_DISABLED_WORKFLOWS` and redeploy;
`practice_sessions` and `session_rating` can be switched off the same way.
Installed extensions cannot be downgraded, so a bad extension release is fixed
forward with a higher version.

### Session evidence and analysis (migrations 0022 and 0023)

Migrations `0022_m2_session_evidence` and `0023_m2_session_analysis` are
additive. Apply them with `pnpm db:release`, which applies every pending
migration in order, **before** deploying code from Phase 4A or later; that
code reads the new columns and tables. Session analysis is BYOK only: it runs
on the user's own saved key, never on the hosted key, and spends no credits.

| Variable | Where | Purpose |
| --- | --- | --- |
| `CRON_SECRET` | Vercel (Production; Preview when testing) | Bearer secret for `GET /api/cron/ai-dispatch`, 32+ random characters. The route answers `404` while it is unset. |
| `ANKIFY_AUTOMATIC_ANALYSIS` | Vercel | Automatic analysis is **on by default** for users with their own key (each can switch it off in Settings). Set `disabled` to switch it off for everyone. |
| `ANKIFY_DISABLED_WORKFLOWS` | Vercel | Add `session_analysis` to switch analysis off. |
| `ANKIFY_QA_AI_BASE_URL` | QA only | Fake-provider URL for browser tests; ignored outside the QA profile. Never set it on Vercel. |

Neither manual nor automatic analysis depends on the cron.

- **Manual:** when a queue publish fails, the job is marked failed and the user gets a `503` to retry.
- **Automatic:** the job is committed with the finished session, set to run about 15 seconds later so late verdicts are included, and published after commit. If that publish fails, the job waits with `dispatched_at` unset.
- **Recovery:** stranded jobs are re-sent when the same user next opens the popup, loads a problem page, or reads an analysis. The optional cron re-sends them for everyone on a timer.

**Before deploying this code to Production, decide:** automatic analysis becomes active for every user who has saved their own key, with no daily cap. Each finished session with captured code (accepted or not, review or first practice) gets one call, and again only if its evidence changes. To keep it off for now, set `ANKIFY_AUTOMATIC_ANALYSIS=disabled` first.

To add the timer-based recovery:

1. Check the Vercel plan's cron limits. Hobby projects can only schedule daily
   cron jobs, and a more frequent schedule fails the deployment. On Hobby, rely
   on request-time recovery.
2. Set `CRON_SECRET` in Vercel and add the schedule to `apps/web/vercel.json`:

   ```json
   "crons": [{ "path": "/api/cron/ai-dispatch", "schedule": "*/5 * * * *" }]
   ```

3. Deploy. Then verify that
   `curl -sS -H "Authorization: Bearer $CRON_SECRET" https://ankify-pi.vercel.app/api/cron/ai-dispatch`
   returns `{"stranded":0,"dispatched":0}`, that the same request without the
   header returns `401`, and that the project's Cron Jobs page shows successful
   runs.

Smoke test: with a user whose own key is saved, finish a session with a failed
submission and then an Accepted one. Click **Analyze session** in the panel.
The job should go `queued -> running -> succeeded`, and the findings should
appear as suggestions to confirm or dismiss.

Rollback: to stop only automatic analysis, set `ANKIFY_AUTOMATIC_ANALYSIS=disabled`.
To stop all analysis, add `session_analysis` to `ANKIFY_DISABLED_WORKFLOWS`;
new jobs are then refused and queued jobs fail before any provider call. Either
way, redeploy. Stored analyses, candidates, confirmed mistakes, and the
deterministic profile stay.

### Suggestions (migrations 0024 and 0025)

`0024_m3_attempt_history` and `0025_m3_suggestions` are additive:

- `0024` adds suggestion candidates, attempt history, and history coverage.
- `0025` adds the suggestions themselves.

Neither backfills anything. Apply both with the others, before deploying
this code. The cold-start catalog ships empty. To fill it:

1. Run `scripts/leetcode-catalog.js` in a leetcode.com tab.
2. Save the output as `apps/web/src/server/suggestions/catalog.json`.
3. Commit it after `catalog.test.ts` passes.

Rollback: add `suggestions` to `ANKIFY_DISABLED_WORKFLOWS` and redeploy.
Allocation, actions, and history merges then answer `503`. Stored suggestions,
attempt history, exclusions, and any practice sessions started from
suggestions stay.

### Legacy suspension (Phase 6B)

Study Coach, AI card and quiz generation, and credit checkout are suspended
by default in this code; there is no schema change.

- Their routes answer `410 workflow_suspended`, and `/api/capabilities` lists
  them as deprecations.
- Card and quiz jobs still queued fail on delivery, before any provider call,
  and refund their hosted credit once.
- The Stripe webhook stays configured: it settles purchases and refunds
  already in flight.
- To re-enable one deliberately (never as a rollback side effect), set
  `ANKIFY_ENABLED_LEGACY_WORKFLOWS` (for example `coach`) and redeploy.

## Rollback boundaries

- Application code can be rolled back independently through Vercel.
- Prefer expand/deploy/contract migrations. Do not run a destructive contract
  migration until every live deployment uses the expanded schema.
- Do not restore a database backup merely to roll back application code.
- Never invalidate all Turso database tokens during a normal release; that also
  invalidates the Vercel runtime credential.
