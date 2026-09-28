import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { getDb } from "@ankify/db";

const migrationsFolder = fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url));

/**
 * Points @ankify/db at a throwaway SQLite file. Call at the top of a test file,
 * before anything calls getDb(). Env set here wins over .env.local, so tests
 * can never reach a Turso database.
 */
export function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "ankify-test-"));
  process.env.TURSO_DATABASE_URL = "";
  process.env.LOCAL_DB_PATH = join(dir, "test.db");

  return {
    /**
     * Applies migrations the way `pnpm db:migrate` does. With `through`, stops
     * after the migration whose tag starts with that prefix (e.g. "0017_"), so a
     * test can seed data in an older schema and then migrate the rest.
     */
    async migrate(options: { through?: string } = {}) {
      if (!options.through) {
        await migrate(getDb(), { migrationsFolder });
        return;
      }
      const partial = join(dir, `migrations-through-${options.through}`);
      cpSync(migrationsFolder, partial, { recursive: true });
      const journalPath = join(partial, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
      const index = journal.entries.findIndex((entry) => entry.tag.startsWith(options.through!));
      if (index < 0) throw new Error(`No migration tagged ${options.through}`);
      journal.entries = journal.entries.slice(0, index + 1);
      writeFileSync(journalPath, JSON.stringify(journal));
      await migrate(getDb(), { migrationsFolder: partial });
    },
    /** Raw SQL (DDL such as failure-injection triggers) outside Drizzle's statement cache. */
    async exec(sqlText: string) {
      await getDb().$client.executeMultiple(sqlText);
    },
    cleanup() {
      getDb().$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** `CREATE TABLE` SQL of a table, for asserting constraints in migration tests. */
export async function tableSql(name: string) {
  const rows = await getDb().all<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${name.replace(/'/g, "")}'`,
  );
  return rows[0]?.sql ?? null;
}
