import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createIdbOutboxStore, openSyncDatabase } from "./idb-store";
import type { OutboxOperation } from "./outbox";

const operation = (id: string, createdAt: number): OutboxOperation => ({
  id,
  accountId: "user-1",
  apiOrigin: "https://ankify.test",
  sessionId: "s1",
  kind: "observations",
  path: "/api/practice-sessions/s1/submissions",
  body: { observations: [{ leetcodeSubmissionId: id, verdict: "Accepted" }] },
  createdAt,
  attempts: 0,
  nextAttemptAt: createdAt,
  state: "pending",
  lastError: null,
});

describe("IndexedDB outbox store", () => {
  it("keeps operations across database connections, as after a worker restart", async () => {
    const factory = new IDBFactory();
    const first = createIdbOutboxStore(() => openSyncDatabase(factory));
    await first.put(operation("a", 1));
    await first.put(operation("b", 2));
    await first.put({ ...operation("a", 1), attempts: 2 });
    await first.remove("b");

    const reopened = createIdbOutboxStore(() => openSyncDatabase(factory));
    expect(await reopened.all()).toEqual([{ ...operation("a", 1), attempts: 2 }]);
    expect(await reopened.get("a")).toMatchObject({ attempts: 2 });
    expect(await reopened.get("missing")).toBeUndefined();
  });

  it("keeps only the most recent rejections", async () => {
    const factory = new IDBFactory();
    const store = createIdbOutboxStore(() => openSyncDatabase(factory));
    for (let index = 0; index < 5; index += 1) {
      await store.addRejection(
        { id: `r${index}`, accountId: "user-1", apiOrigin: "https://ankify.test", sessionId: "s1", kind: "command", status: 409, code: "invalid_transition", at: index },
        3,
      );
    }
    expect((await store.rejections()).map((rejection) => rejection.id)).toEqual(["r2", "r3", "r4"]);
  });
});
