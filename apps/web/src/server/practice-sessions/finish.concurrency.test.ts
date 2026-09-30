import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { createTestDb } from "../test-db";
import { runSessionCommand, startPracticeSession } from "./commands";
import { expectOnlyBusy, RACE_T0, raceStartInput } from "./race-fixtures";

const testDb = createTestDb();
const USER = "session-race";
const TAB = "00000000-0000-4000-8000-000000000001";
let sessionId: string;

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER, name: "Race", email: "race-finish@example.test" });
  const started = await startPracticeSession(USER, raceStartInput(crypto.randomUUID(), TAB), RACE_T0);
  if (!started.ok) throw new Error(started.error);
  sessionId = started.response.session.id;
});
afterAll(() => testDb.cleanup());

it("applies a duplicated finish once", async () => {
  const now = new Date(RACE_T0.getTime() + 60_000);
  const input = { type: "finish" as const, requestId: crypto.randomUUID(), ownerToken: TAB, result: "solved" as const, occurredAt: now.toISOString() };
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => runSessionCommand(USER, sessionId, input, now)));
  expectOnlyBusy(results);
  const applied = results.flatMap((result) => (result.status === "fulfilled" && result.value.ok ? [result.value.response] : []));
  expect(applied.filter((response) => !response.idempotentReplay)).toHaveLength(1);
  const commands = await getDb().select().from(schema.practiceSessionCommands);
  expect(commands.filter((command) => command.command === "finish")).toHaveLength(1);
  const [session] = await getDb().select().from(schema.practiceSessions);
  expect(session).toMatchObject({ status: "completed", revision: 1 });
});
