import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/server/test-db";
import { QA_SECOND_SESSION_ID, QA_SECOND_USER_ID, QA_SESSION_ID, QA_SESSION_TOKEN, QA_USER_ID } from "@/server/qa";
import { GET } from "./route";

const testDb = createTestDb();
const login = (query = "") => GET(new Request(`http://localhost:3000/api/qa/login${query}`));
const sessionRow = async (id: string) => (await getDb().select().from(schema.session).where(eq(schema.session.id, id)))[0];

beforeAll(() => testDb.migrate());
afterAll(() => testDb.cleanup());
beforeEach(async () => {
  vi.stubEnv("ANKIFY_PROFILE", "qa");
  vi.stubEnv("BETTER_AUTH_SECRET", "qa-login-test-secret-qa-login-test-secret");
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values([
    { id: QA_USER_ID, name: "QA", email: "qa@ankify.local" },
    { id: QA_SECOND_USER_ID, name: "QA 2", email: "qa2@ankify.local" },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

describe("QA sign-in", () => {
  it("recreates the session a web sign-out deleted, and continues to a safe next path", async () => {
    expect(await sessionRow(QA_SESSION_ID)).toBeUndefined();
    const response = await login("?next=%2Fextension-connected");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/extension-connected");
    expect(response.headers.get("set-cookie")).toContain(`better-auth.session_token=${QA_SESSION_TOKEN}.`);
    expect(await sessionRow(QA_SESSION_ID)).toMatchObject({ userId: QA_USER_ID, token: QA_SESSION_TOKEN });

    // Signing in again refreshes the same row.
    await login();
    expect(await getDb().select().from(schema.session).where(eq(schema.session.userId, QA_USER_ID))).toHaveLength(1);
  });

  it("signs in the second account, and never redirects off the site", async () => {
    for (const next of ["//evil.example", "/\\evil.example", "https://evil.example", "/api/me"]) {
      const response = await login(`?account=second&next=${encodeURIComponent(next)}`);
      expect(response.headers.get("location")).toBe("http://localhost:3000/today");
    }
    expect(await sessionRow(QA_SECOND_SESSION_ID)).toMatchObject({ userId: QA_SECOND_USER_ID });
  });

  it("explains a missing QA account, and does not exist outside the QA profile", async () => {
    await getDb().delete(schema.user).where(eq(schema.user.id, QA_USER_ID));
    expect((await login()).status).toBe(409);
    vi.stubEnv("ANKIFY_PROFILE", "local");
    expect((await login()).status).toBe(404);
  });
});
