import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

describe("database invariants", () => {
  let dir: string;
  let client: Client;

  beforeEach(async () => {
    dir = await mkdtemp(resolve(tmpdir(), "ankify-db-test-"));
    client = createClient({ url: `file:${resolve(dir, "test.db")}` });
    await migrate(drizzle(client), { migrationsFolder });
    await client.execute({
      sql: "INSERT INTO user (id, name, email) VALUES (?, ?, ?)",
      args: ["user-1", "Test", "test@example.com"],
    });
    await client.execute({
      sql: `INSERT INTO problems (id, user_id, leetcode_slug, title, difficulty, url)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["problem-1", "user-1", "two-sum", "Two Sum", "Easy", "https://leetcode.com/problems/two-sum/"],
    });
  });

  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("initializes the FSRS-6 learning step state", async () => {
    const result = await client.execute("SELECT fsrs_learning_steps FROM problems WHERE id = 'problem-1'");
    expect(result.rows[0]?.fsrs_learning_steps).toBe(0);
  });

  it("allows only one non-archived quiz session per problem", async () => {
    const insert = (id: string, status: string) =>
      client.execute({
        sql: `INSERT INTO quiz_sessions (id, user_id, problem_id, status, items_json, answers_json)
              VALUES (?, ?, ?, ?, json('[]'), json('[]'))`,
        args: [id, "user-1", "problem-1", status],
      });

    await insert("quiz-1", "active");
    await expect(insert("quiz-2", "completed")).rejects.toThrow();
    await insert("quiz-archive", "archived");
  });

  it("allows only one running AI job per user", async () => {
    const insertJob = (id: string) => client.execute({
      sql: `INSERT INTO ai_jobs (
              id, user_id, problem_id, kind, action, idempotency_key,
              active_dedup_key, input_envelope, provider, model,
              reasoning_mode, generation_language
            ) VALUES (?, 'user-1', 'problem-1', 'card', 'card_generate', ?, ?, json(?),
                      'openai', 'gpt-4.1-mini', 'fast', 'en')`,
      args: [id, `request-${id}`, `card-generate-${id}`, JSON.stringify({ v: 1, iv: "iv", ciphertext: "ciphertext" })],
    });
    await insertJob("job-1");
    await insertJob("job-2");

    const claims = await Promise.allSettled([
      client.execute("UPDATE ai_jobs SET status = 'running' WHERE id = 'job-1'"),
      client.execute("UPDATE ai_jobs SET status = 'running' WHERE id = 'job-2'"),
    ]);
    expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("supports multiple Agent sessions and one active run per session", async () => {
    const insertSession = (id: string) =>
      client.execute({
        sql: `INSERT INTO agent_sessions (id, user_id, title)
              VALUES (?, 'user-1', 'Session')`,
        args: [id],
      });
    await insertSession("session-1");
    await insertSession("session-2");

    const insertRun = (id: string, requestId: string) =>
      client.execute({
        sql: `INSERT INTO agent_runs (
                id, user_id, session_id, request_id, context_json, provider, model
              ) VALUES (?, 'user-1', 'session-1', ?, json(?), 'openai', 'gpt-5-mini')`,
        args: [id, requestId, JSON.stringify({ page: "review", activePanel: "cards", problemId: "problem-1" })],
      });
    await insertRun("run-1", "14c3fc2b-d67c-49d2-bb7b-28d4210092c4");
    await expect(
      insertRun("run-2", "24c3fc2b-d67c-49d2-bb7b-28d4210092c4"),
    ).rejects.toThrow();

    await client.execute("UPDATE agent_runs SET status = 'succeeded' WHERE id = 'run-1'");
    await insertRun("run-2", "24c3fc2b-d67c-49d2-bb7b-28d4210092c4");
  });

  it("releases a session after its Agent run becomes stale", async () => {
    await client.execute(
      "INSERT INTO agent_sessions (id, user_id, title) VALUES ('session-1', 'user-1', 'Session')",
    );
    await client.execute({
      sql: `INSERT INTO agent_runs (
              id, user_id, session_id, request_id, context_json, provider, model, started_at
            ) VALUES ('run-stale', 'user-1', 'session-1', ?, json(?),
                      'openai', 'gpt-5-mini', ?)`,
      args: [
        "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
        JSON.stringify({ page: "today", activePanel: "overview", problemId: null }),
        Date.now() - 241_000,
      ],
    });

    const now = Date.now();
    await client.execute({
      sql: `UPDATE agent_runs
            SET status = 'failed', error_code = 'agent_interrupted', finished_at = ?
            WHERE user_id = 'user-1' AND session_id = 'session-1'
              AND status = 'running' AND started_at < ?`,
      args: [now, now - 240_000],
    });
    await client.execute({
      sql: `INSERT INTO agent_runs (
              id, user_id, session_id, request_id, context_json, provider, model
            ) VALUES ('run-next', 'user-1', 'session-1', ?, json(?),
                      'openai', 'gpt-5-mini')`,
      args: [
        "24c3fc2b-d67c-49d2-bb7b-28d4210092c4",
        JSON.stringify({ page: "today", activePanel: "overview", problemId: null }),
      ],
    });

    const result = await client.execute(
      "SELECT id, status, error_code FROM agent_runs ORDER BY started_at",
    );
    expect(result.rows).toMatchObject([
      { id: "run-stale", status: "failed", error_code: "agent_interrupted" },
      { id: "run-next", status: "running", error_code: null },
    ]);
  });

  it("stores one user and one assistant message for each Agent run", async () => {
    await client.batch(
      [
        {
          sql: `INSERT INTO agent_sessions (id, user_id, title)
                VALUES ('session-1', 'user-1', 'Two Sum')`,
          args: [],
        },
        {
          sql: `INSERT INTO agent_runs (
                  id, user_id, session_id, request_id, context_json, provider, model
                ) VALUES ('run-1', 'user-1', 'session-1', ?, json(?), 'openai', 'gpt-5-mini')`,
          args: [
            "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
            JSON.stringify({ page: "problem", activePanel: "overview", problemId: "problem-1" }),
          ],
        },
      ],
      "write",
    );
    const insertMessage = (id: string, role: string) =>
      client.execute({
        sql: `INSERT INTO agent_messages (id, user_id, session_id, run_id, role, content)
              VALUES (?, 'user-1', 'session-1', 'run-1', ?, 'message')`,
        args: [id, role],
      });
    await insertMessage("message-1", "user");
    await expect(insertMessage("message-2", "user")).rejects.toThrow();
    await insertMessage("message-3", "assistant");
  });

  it("lets only one writer commit a card version", async () => {
    await client.execute({
      sql: `INSERT INTO cards (id, user_id, problem_id, question, answer)
            VALUES ('card-race', 'user-1', 'problem-1', 'Q', 'A')`,
      args: [],
    });
    const writes = await Promise.all([
      client.execute("UPDATE cards SET answer = 'A1', version = version + 1 WHERE id = 'card-race' AND version = 1"),
      client.execute("UPDATE cards SET answer = 'A2', version = version + 1 WHERE id = 'card-race' AND version = 1"),
    ]);
    expect(writes.reduce((sum, result) => sum + result.rowsAffected, 0)).toBe(1);
    const result = await client.execute("SELECT version FROM cards WHERE id = 'card-race'");
    expect(result.rows[0]?.version).toBe(2);
  });

  it("scopes review idempotency keys per user", async () => {
    const insertEvent = (id: string) =>
      client.execute({
        sql: `INSERT INTO review_events (id, user_id, problem_id, event_type, request_id)
              VALUES (?, ?, ?, 'self_recall_rated', ?)`,
        args: [id, "user-1", "problem-1", "14c3fc2b-d67c-49d2-bb7b-28d4210092c4"],
      });

    await insertEvent("event-1");
    await expect(insertEvent("event-2")).rejects.toThrow();
  });

  it("deleting a user cascades through authentication and business data", async () => {
    await client.batch(
      [
        {
          sql: `INSERT INTO session (id, user_id, expires_at, token)
                VALUES (?, ?, unixepoch() * 1000 + 60000, ?)`,
          args: ["session-1", "user-1", "session-token"],
        },
        {
          sql: `INSERT INTO account (id, user_id, provider_id, account_id)
                VALUES (?, ?, ?, ?)`,
          args: ["account-1", "user-1", "google", "google-account-1"],
        },
        {
          sql: `INSERT INTO submissions (id, user_id, problem_id, language, code, status)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: ["submission-1", "user-1", "problem-1", "typescript", "return 0", "Accepted"],
        },
        {
          sql: `INSERT INTO cards (id, user_id, problem_id, question, answer)
                VALUES (?, ?, ?, ?, ?)`,
          args: ["card-1", "user-1", "problem-1", "Question", "Answer"],
        },
        {
          sql: `INSERT INTO review_events (id, user_id, problem_id, event_type, card_id, submission_id)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: ["event-1", "user-1", "problem-1", "card_created", "card-1", "submission-1"],
        },
        {
          sql: `INSERT INTO quiz_sessions (id, user_id, problem_id, status, items_json, answers_json)
                VALUES (?, ?, ?, 'archived', json('[]'), json('[]'))`,
          args: ["quiz-1", "user-1", "problem-1"],
        },
        {
          sql: `INSERT INTO settings (user_id, key, value)
                VALUES (?, ?, json(?))`,
          args: ["user-1", "daily_review_limit", "20"],
        },
        {
          sql: `INSERT INTO agent_sessions (id, user_id, title)
                VALUES ('session-1', 'user-1', 'Two Sum')`,
          args: [],
        },
        {
          sql: `INSERT INTO agent_runs (
                  id, user_id, session_id, request_id, context_json, provider, model
                ) VALUES ('run-1', 'user-1', 'session-1', ?, json(?), 'openai', 'gpt-5-mini')`,
          args: [
            "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
            JSON.stringify({ page: "review", activePanel: "cards", problemId: "problem-1" }),
          ],
        },
        {
          sql: `INSERT INTO agent_messages (id, user_id, session_id, run_id, role, content)
                VALUES ('message-1', 'user-1', 'session-1', 'run-1', 'user', 'Help me')`,
          args: [],
        },
        {
          sql: `INSERT INTO agent_steps (
                  id, user_id, run_id, sequence, kind, tool_name, status, summary
                ) VALUES ('step-1', 'user-1', 'run-1', 1, 'read',
                          'get_problem_context', 'completed', 'Loaded context')`,
          args: [],
        },
      ],
      "write",
    );

    await client.execute({
      sql: "DELETE FROM user WHERE id = ?",
      args: ["user-1"],
    });

    for (const table of [
      "user",
      "session",
      "account",
      "problems",
      "submissions",
      "cards",
      "review_events",
      "quiz_sessions",
      "agent_sessions",
      "agent_runs",
      "agent_messages",
      "agent_steps",
      "settings",
    ]) {
      const result = await client.execute(`SELECT count(*) AS count FROM ${table}`);
      expect(Number(result.rows[0]?.count), table).toBe(0);
    }
  });
});
