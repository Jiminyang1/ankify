import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { createTestDb } from "../test-db";
import { ingestSessionObservations, startPracticeSession } from "./commands";
import { expectOnlyBusy, RACE_T0, raceStartInput } from "./race-fixtures";

const testDb = createTestDb();
const USER = "session-race";
let sessionId: string;

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER, name: "Race", email: "race-observe@example.test" });
  const started = await startPracticeSession(USER, raceStartInput(crypto.randomUUID(), "00000000-0000-4000-8000-000000000001"), RACE_T0);
  if (!started.ok) throw new Error(started.error);
  sessionId = started.response.session.id;
});
afterAll(() => testDb.cleanup());

it("stores one observation and one submission when the same submission is reported concurrently", async () => {
  const observation = {
    leetcodeSubmissionId: "5001",
    verdict: "Accepted" as const,
    submittedAt: new Date(RACE_T0.getTime() + 30_000).toISOString(),
    detail: { language: "python3", code: "pass" },
  };
  const now = new Date(RACE_T0.getTime() + 90_000);
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => ingestSessionObservations(USER, sessionId, { observations: [observation] }, now)),
  );
  expectOnlyBusy(results);
  expect(results.some((result) => result.status === "fulfilled" && result.value.ok)).toBe(true);
  expect(await getDb().select().from(schema.practiceSessionSubmissions)).toHaveLength(1);
  expect(await getDb().select().from(schema.submissions)).toHaveLength(1);
});
