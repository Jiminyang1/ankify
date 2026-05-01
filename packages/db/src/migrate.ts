import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { getDb } from "./client";

// Load .env.local from monorepo root so `pnpm db:migrate` works from any cwd.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../../.env.local");
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

async function main() {
  const migrationsFolder = resolve(here, "../drizzle");
  const db = getDb();
  await migrate(db, { migrationsFolder });
  console.log("✓ migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
