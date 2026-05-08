import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { loadEnvFile } from "./env";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
let _envLoaded = false;

function findRepoRoot(start: string): string {
  let dir = start;
  while (true) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml")) && existsSync(resolve(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function repoRoot(): string {
  return findRepoRoot(process.cwd());
}

/**
 * Load env files for CLI tools (drizzle-kit, migrate.ts).
 *
 * Profile selection:
 *   - ANKIFY_PROFILE=production → load `.env.production.local` (writes to prod Turso)
 *   - otherwise                  → load `.env.local`            (writes to local SQLite)
 *
 * Next.js dev server doesn't need this — it loads `.env.local` itself. This
 * helper only runs from `tsx` / `drizzle-kit` CLI entry points.
 *
 * Env vars already in `process.env` win over the file (so `ANKIFY_PROFILE=...`
 * passed on the command line is respected, and CI can override anything).
 */
export function loadDbEnv() {
  if (_envLoaded) return;
  _envLoaded = true;

  const root = repoRoot();
  const profile = process.env.ANKIFY_PROFILE === "production" ? "production" : "local";
  const profileFile = profile === "production" ? ".env.production.local" : ".env.local";

  const existingEnv = new Map(Object.entries(process.env));
  loadEnvFile(resolve(root, ".env"));
  loadEnvFile(resolve(root, profileFile), true);
  for (const [key, value] of existingEnv) {
    process.env[key] = value;
  }

  if (!process.env.TURSO_DATABASE_URL && !process.env.LOCAL_DB_PATH) {
    if (profile === "production") {
      throw new Error(
        `TURSO_DATABASE_URL missing in ${profileFile}: production profile requires Turso, not local SQLite`,
      );
    }
    process.env.LOCAL_DB_PATH = resolve(root, "packages/db/local.db");
  }
}
function localDbPath(): string {
  const root = repoRoot();
  const configured = process.env.LOCAL_DB_PATH ?? resolve(root, "packages/db/local.db");
  return isAbsolute(configured) ? configured : resolve(root, configured);
}

function buildClient(): Client {
  loadDbEnv();

  // Profile selection: Turso URL wins. loadDbEnv() guarantees LOCAL_DB_PATH is
  // set when no Turso URL is present, and refuses to fall back to SQLite when
  // ANKIFY_PROFILE=production. The Vercel runtime sets TURSO_DATABASE_URL via
  // dashboard env, so production deploys go through the Turso branch.
  const remoteUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (remoteUrl) {
    return createClient({ url: remoteUrl, authToken });
  }

  return createClient({ url: `file:${localDbPath()}` });
}

export function getDb() {
  if (!_db) {
    _db = drizzle(buildClient(), { schema });
  }
  return _db;
}

export type DB = ReturnType<typeof getDb>;
export { schema };
