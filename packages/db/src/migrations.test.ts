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
      "settings",
    ]) {
      const result = await client.execute(`SELECT count(*) AS count FROM ${table}`);
      expect(Number(result.rows[0]?.count), table).toBe(0);
    }
  });
});
