import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

// Constraints that must hold even if application code has a bug: one open
// session per problem, observations pinned to their session's owner, one
// session per LeetCode submission, and one scheduling event per session.
describe("practice session invariants", () => {
  let dir: string;
  let client: Client;

  const session = (id: string, opts: { problem?: string; user?: string; open?: 0 | 1; status?: string } = {}) =>
    client.execute({
      sql: `INSERT INTO practice_sessions (id, user_id, problem_id, request_id, type, review_intent, status, is_open, schedule_revision_at_start)
            VALUES (?, ?, ?, ?, 'voluntary_practice', 'none', ?, ?, 0)`,
      args: [id, opts.user ?? "user-1", opts.problem ?? "problem-1", `request-${id}`, opts.status ?? "active", opts.open ?? 1],
    });
  const observation = (id: string, sessionId: string, opts: { lc?: string | null; client?: string | null; user?: string; problem?: string } = {}) =>
    client.execute({
      sql: `INSERT INTO practice_session_submissions (id, user_id, session_id, problem_id, leetcode_submission_id, client_observation_id, verdict, detail_status, association)
            VALUES (?, ?, ?, ?, ?, ?, 'Wrong Answer', 'pending', 'automatic')`,
      args: [id, opts.user ?? "user-1", sessionId, opts.problem ?? "problem-1", opts.lc === undefined ? `lc-${id}` : opts.lc, opts.client ?? null],
    });

  beforeEach(async () => {
    dir = await mkdtemp(resolve(tmpdir(), "ankify-db-test-"));
    client = createClient({ url: `file:${resolve(dir, "test.db")}` });
    await migrate(drizzle(client), { migrationsFolder });
    await client.batch([
      "INSERT INTO user (id, name, email) VALUES ('user-1', 'One', 'one@example.com'), ('user-2', 'Two', 'two@example.com')",
      `INSERT INTO problems (id, user_id, leetcode_slug, title, difficulty, url) VALUES
        ('problem-1', 'user-1', 'two-sum', 'Two Sum', 'Easy', 'https://leetcode.com/problems/two-sum/'),
        ('problem-2', 'user-1', '3sum', '3Sum', 'Medium', 'https://leetcode.com/problems/3sum/'),
        ('problem-other', 'user-2', 'two-sum', 'Two Sum', 'Easy', 'https://leetcode.com/problems/two-sum/')`,
    ], "write");
  });

  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("starts existing problems enrolled at schedule revision zero", async () => {
    const result = await client.execute("SELECT schedule_revision, enrollment FROM problems WHERE id = 'problem-1'");
    expect(result.rows[0]).toMatchObject({ schedule_revision: 0, enrollment: "enrolled" });
  });

  it("allows one open session per problem while closed sessions accumulate", async () => {
    await session("s1");
    await expect(session("s2")).rejects.toThrow();
    await session("s2", { problem: "problem-2" });
    await session("s3", { open: 0, status: "completed" });
    await session("s4", { open: 0, status: "interrupted" });
    await client.execute("UPDATE practice_sessions SET is_open = 0, status = 'completed' WHERE id = 's1'");
    await session("s5");
  });

  it("pins observations to their session's user and problem", async () => {
    await session("s1");
    await session("s-other", { user: "user-2", problem: "problem-other" });
    await expect(observation("o1", "s1", { problem: "problem-2" })).rejects.toThrow();
    await expect(observation("o2", "s1", { user: "user-2", problem: "problem-other" })).rejects.toThrow();
    await expect(observation("o3", "s-other")).rejects.toThrow();
    await observation("o4", "s1");
  });

  it("requires a LeetCode id or a client observation id", async () => {
    await session("s1");
    await expect(observation("o1", "s1", { lc: null, client: null })).rejects.toThrow();
    await observation("o2", "s1", { lc: null, client: "client-o2" });
    await expect(observation("o3", "s1", { lc: null, client: "client-o2" })).rejects.toThrow();
  });

  it("associates a LeetCode submission id with at most one session per user", async () => {
    await session("s1");
    await session("s2", { problem: "problem-2" });
    await session("s-other", { user: "user-2", problem: "problem-other" });
    await observation("o1", "s1", { lc: "9001" });
    await expect(observation("o2", "s2", { lc: "9001" })).rejects.toThrow();
    await observation("o3", "s-other", { lc: "9001", user: "user-2", problem: "problem-other" });
  });

  it("records at most one rating and one initial scheduling event per session", async () => {
    await session("s1");
    const event = (id: string, type: string, sessionId: string | null) =>
      client.execute({
        sql: `INSERT INTO review_events (id, user_id, problem_id, event_type, practice_session_id) VALUES (?, 'user-1', 'problem-1', ?, ?)`,
        args: [id, type, sessionId],
      });
    await event("e1", "self_recall_rated", "s1");
    await expect(event("e2", "self_recall_rated", "s1")).rejects.toThrow();
    await event("e3", "fsrs_scheduled", "s1");
    await expect(event("e4", "fsrs_scheduled", "s1")).rejects.toThrow();
    await event("e5", "submission_imported", "s1");
    await event("e6", "submission_imported", "s1");
    await event("e7", "self_recall_rated", null);
    await event("e8", "self_recall_rated", null);
  });

  it("refuses to delete a session that scheduling history refers to, but cascades with its problem", async () => {
    await session("s1");
    await observation("o1", "s1");
    await client.execute("INSERT INTO review_events (id, user_id, problem_id, event_type, practice_session_id) VALUES ('e1', 'user-1', 'problem-1', 'self_recall_rated', 's1')");
    await expect(client.execute("DELETE FROM practice_sessions WHERE id = 's1'")).rejects.toThrow();
    await client.execute("DELETE FROM problems WHERE id = 'problem-1'");
    for (const table of ["practice_sessions", "practice_session_submissions", "review_events"]) {
      const result = await client.execute(`SELECT count(*) AS count FROM ${table}`);
      expect(Number(result.rows[0]?.count), table).toBe(0);
    }
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  });
});
