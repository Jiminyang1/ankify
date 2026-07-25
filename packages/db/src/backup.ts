import { createClient, type Client, type InValue } from "@libsql/client";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadDbEnv } from "./client";

/**
 * Dump the production Turso database into a plain local SQLite file under
 * <repo>/backups/ (gitignored — the dump contains session tokens and
 * encrypted AI keys). Run via `pnpm db:backup`; requires TURSO_DATABASE_URL
 * in .env.production.local. Read-only against the remote.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

/** sqlite_* are SQLite-internal; libsql_* / _litestream_* are Turso-internal. */
const INTERNAL_NAME = /^(sqlite_|libsql_|_litestream_)/;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function copyTable(remote: Client, local: Client, table: string): Promise<number> {
  const result = await remote.execute(`SELECT * FROM "${table}"`);
  if (result.rows.length === 0) return 0;

  const cols = result.columns;
  const colList = cols.map((c) => `"${c}"`).join(", ");
  // Stay well under SQLite's bound-parameter limit.
  const rowsPerChunk = Math.max(1, Math.floor(400 / cols.length));

  for (let offset = 0; offset < result.rows.length; offset += rowsPerChunk) {
    const chunk = result.rows.slice(offset, offset + rowsPerChunk);
    const placeholders = chunk
      .map(() => `(${cols.map(() => "?").join(", ")})`)
      .join(", ");
    const args: InValue[] = [];
    for (const row of chunk) {
      for (const col of cols) {
        args.push((row[col] ?? null) as InValue);
      }
    }
    await local.execute({
      sql: `INSERT INTO "${table}" (${colList}) VALUES ${placeholders}`,
      args,
    });
  }
  return result.rows.length;
}

async function main() {
  loadDbEnv();
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "db:backup requires TURSO_DATABASE_URL — it backs up the production Turso database. Fill .env.production.local.",
    );
  }

  const backupDir = resolve(repoRoot, "backups");
  mkdirSync(backupDir, { recursive: true });
  const outPath = resolve(backupDir, `ankify-prod-${timestamp()}.db`);
  if (existsSync(outPath)) {
    throw new Error(`backup target already exists: ${outPath}`);
  }

  const remote = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const local = createClient({ url: `file:${outPath}` });

  try {
    const master = await remote.execute(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name`,
    );
    const objects = master.rows.filter((row) => !INTERNAL_NAME.test(String(row.name)));

    // Insertion order is arbitrary, so keep FK enforcement off while copying.
    await local.execute("PRAGMA foreign_keys = OFF");
    for (const row of objects) {
      await local.execute(String(row.sql));
    }

    const tables = objects.filter((row) => row.type === "table").map((row) => String(row.name));
    let totalRows = 0;
    for (const table of tables) {
      const count = await copyTable(remote, local, table);
      totalRows += count;
      console.log(`  ${table}: ${count} rows`);
    }

    const fkCheck = await local.execute("PRAGMA foreign_key_check");
    if (fkCheck.rows.length > 0) {
      throw new Error(`backup integrity check failed: ${fkCheck.rows.length} foreign key violations`);
    }

    const sizeKb = Math.round(statSync(outPath).size / 1024);
    console.log(`✓ backed up ${tables.length} tables, ${totalRows} rows → ${outPath} (${sizeKb} KB)`);
  } finally {
    local.close();
    remote.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
