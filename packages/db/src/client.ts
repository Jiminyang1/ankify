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

export function loadDbEnv() {
  if (_envLoaded) return;
  _envLoaded = true;

  const root = repoRoot();
  loadEnvFile(resolve(root, ".env"));
  loadEnvFile(resolve(root, ".env.local"), true);

  if (!process.env.TURSO_DATABASE_URL && !process.env.LOCAL_DB_PATH) {
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
