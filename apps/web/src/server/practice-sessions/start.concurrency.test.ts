import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { createTestDb } from "../test-db";
import { startPracticeSession } from "./commands";
import { expectOnlyBusy, RACE_T0, raceStartInput } from "./race-fixtures";

const testDb = createTestDb();
const USER = "session-race";

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER, name: "Race", email: "race-start@example.test" });
});
afterAll(() => testDb.cleanup());

it("creates at most one problem and one open session when starts race", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, index) =>
      startPracticeSession(USER, raceStartInput(crypto.randomUUID(), `00000000-0000-4000-8000-00000000000${index}`), RACE_T0),
    ),
  );
  expectOnlyBusy(results);
  expect(results.some((result) => result.status === "fulfilled" && result.value.ok)).toBe(true);
  expect(await getDb().select().from(schema.problems)).toHaveLength(1);
  expect(await getDb().select().from(schema.practiceSessions)).toHaveLength(1);
});
