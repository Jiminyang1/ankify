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
   recognizable Production data.
5. Open Study Coach from a global page and a problem page. Verify session list,
   one ToolLoopAgent turn, a read-only tool call, streaming completion, and
   navigation. A valid provider/model/key must be saved in the current user's
   Production Settings before this test.
6. Verify the `ankify-ai-generation` Queue trigger exists, then run one queued
   Card or Quiz job through `queued -> running -> succeeded`.
7. Inspect Vercel runtime logs and clean up any sessions or candidate content
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
Chrome Web Store.

## Rollback boundaries

- Application code can be rolled back independently through Vercel.
- Prefer expand/deploy/contract migrations. Do not run a destructive contract
  migration until every live deployment uses the expanded schema.
- Do not restore a database backup merely to roll back application code.
- Never invalidate all Turso database tokens during a normal release; that also
  invalidates the Vercel runtime credential.
