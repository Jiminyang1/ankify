import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getDb, loadDbEnv } from "./client";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  loadDbEnv();
  const migrationsFolder = resolve(here, "../drizzle");
  const db = getDb();
  await migrate(db, { migrationsFolder });
  console.log("✓ migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
