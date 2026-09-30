import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { iterateAccountExport } from "./account-export";

const testDb = createTestDb();
const owners = ["history-owner", "history-other"];
const protectedTables = ["problems", "submissions", "review_events"] as const;

async function snapshot(tables: readonly string[]) {
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    // Table names are constants in this file. Values remain parameterized and
    // every protected-data read is scoped to its owner, even in fixtures.
    for (const userId of owners) {
      const rows = await getDb().$client.execute({ sql: `SELECT * FROM ${table} WHERE user_id = ? ORDER BY id`, args: [userId] });
      result[`${table}/${userId}`] = rows.rows;
    }
  }
  return result;
}
afterAll(() => testDb.cleanup());

it("preserves protected history across 0019 -> 0020, future migrations, and replay", async () => {
  await testDb.migrate({ through: "0019_" });
  await testDb.exec(readFileSync(new URL("./fixtures/protected-history-0019.sql", import.meta.url), "utf8"));
  const previous = await snapshot(protectedTables);
  await testDb.migrate({ through: "0020_" });
  expect(await snapshot(protectedTables)).toEqual(previous);

  await testDb.exec(readFileSync(new URL("./fixtures/protected-mistakes-0020.sql", import.meta.url), "utf8"));
  const tables = [...protectedTables, "mistake_records"];
  const baseline = await snapshot(tables);
  await testDb.migrate();
  // Compare every pre-existing column, allowing additive columns in M1/M2.
  // Row count/order remain exact, so this cannot hide dropped/duplicated rows.
  const after = await snapshot(tables) as Record<string, Record<string, unknown>[]>;
  for (const [key, value] of Object.entries(baseline)) {
    const rows = value as Record<string, unknown>[];
    expect(after[key]).toHaveLength(rows.length);
    rows.forEach((row, index) => expect(after[key]![index]).toMatchObject(row));
  }
  expect((await getDb().$client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  // M1: existing problems stay enrolled at revision zero; existing events and
  // submissions stay sessionless and carry no invented scheduling provenance.
  for (const row of after[`problems/${owners[0]}`]!) expect(row).toMatchObject({ schedule_revision: 0, enrollment: "enrolled" });
  for (const row of after[`review_events/${owners[0]}`]!) {
    expect(row).toMatchObject({ practice_session_id: null, policy_version: null, review_method: null, schedule_revision: null });
  }
  expect((await getDb().$client.execute("SELECT count(*) AS count FROM practice_session_submissions")).rows[0]).toMatchObject({ count: 0 });
  await testDb.migrate();
  expect(await snapshot(tables)).toEqual(after);

  const exported: { type: string; data: unknown }[] = [];
  for await (const record of iterateAccountExport({ id: owners[0]!, name: "History Owner", email: "history@example.test", image: null })) exported.push(record);
  expect(exported.filter((row) => row.type === "problem")).toHaveLength(2);
  expect(exported.filter((row) => row.type === "submission")).toHaveLength(2);
  expect(exported.filter((row) => row.type === "review_event")).toHaveLength(2);
  expect(exported.find((row) => row.type === "mistake_record")?.data).toMatchObject({ id: "history-mistake", status: "confirmed" });
  expect(JSON.stringify(exported)).not.toContain("Private other notes");

  await getDb().delete(schema.user).where(eq(schema.user.id, owners[0]!));
  for (const table of tables) {
    expect((await getDb().$client.execute({ sql: `SELECT id FROM ${table} WHERE user_id = ?`, args: [owners[0]!] })).rows).toEqual([]);
  }
  expect(await getDb().select().from(schema.problems).where(eq(schema.problems.userId, owners[1]!))).toHaveLength(1);
});
