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
  // A local database is shared by separate processes (the dev server and the
  // QA AI worker). In WAL mode their readers and writers no longer block each
  // other into SQLITE_BUSY; the mode persists in the file. Turso is untouched.
  if (!process.env.TURSO_DATABASE_URL) await db.$client.execute("PRAGMA journal_mode = WAL");
  console.log("✓ migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
