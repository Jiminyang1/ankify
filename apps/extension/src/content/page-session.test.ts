import type { PracticeSessionDto } from "@ankify/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ContentMessage } from "../shared/protocol";
import type { LeetcodeClient, ListedSubmission, Read } from "./leetcode-client";
import { createPageSession, TICK_MS } from "./page-session";

const START = "2026-09-29T12:00:00.000Z";

function session(overrides: Partial<PracticeSessionDto> = {}, capture: Partial<PracticeSessionDto["capture"]> = {}): PracticeSessionDto {
  return {
    id: "s1", problemId: "p1", type: "scheduled_review", reviewMethod: "leetcode_full_solve", reviewIntent: "due",
    status: "active", stale: false, outcome: null, revision: 0, ownership: "you",
    rating: { disposition: "not_applicable", expiresAt: null },
    capture: { completeness: "complete", baselineState: "established", baselineSubmissionId: "1000", ...capture },
    timing: { startedAt: START, lastActivityAt: START, completedAt: null, completedAtAdjusted: false, wallMs: 0, activeMs: 0, observedMs: 0 },
    evidence: { submissions: 0, accepted: 0, failed: 0, pendingDetails: 0, ambiguous: 0, firstAcceptedAt: null },
    sourceAccount: null, createdAt: START, updatedAt: START, ...overrides,
  };
}

const problem = { id: "p1", leetcodeSlug: "two-sum", title: "Two Sum", difficulty: "Easy" as const, url: "https://leetcode.com/problems/two-sum/",
  enrollment: "enrolled" as const, archived: false, fsrsState: "review" as const, fsrsDue: START, due: true, scheduleRevision: 0 };

function harness(options: {
  listing?: () => Read<{ submissions: ListedSubmission[]; complete: boolean }>;
  respond?: (message: ContentMessage) => unknown;
  accountAvailability?: "available" | "signed_out";
} = {}) {
  let now = Date.parse(START);
  let active = true;
  const tasks: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const sent: ContentMessage[] = [];
  const listing = options.listing ?? (() => ({ availability: "available" as const, value: { complete: true, submissions: [] } }));
  const client = {
    listSubmissions: vi.fn(async () => listing()),
    readSubmissionDetail: vi.fn(async () => ({ availability: "available" as const, value: { language: "Python3", code: "pass" } })),
    readProblem: vi.fn(async () => ({ availability: "available" as const, value: { leetcodeSlug: "two-sum", leetcodeId: 1, title: "Two Sum", difficulty: "Easy" as const, url: "https://leetcode.com/problems/two-sum/", topicTags: [], similarSlugs: [] } })),
    readAccount: vi.fn(async () =>
      options.accountAvailability === "signed_out"
        ? { availability: "signed_out" as const, value: null }
        : { availability: "available" as const, value: { username: "leet_user" } }),
  } as unknown as LeetcodeClient;
  const page = createPageSession({
    slug: "two-sum",
    client,
    now: () => now,
    isActive: () => active,
    schedule: (run, ms) => {
      const task = { run, ms, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    send: async <T,>(message: ContentMessage) => {
      sent.push(message);
      return (options.respond?.(message) ?? { ok: true, response: {} }) as never as { ok: true; response: T };
    },
  });
  const pending = () => tasks.filter((task) => !task.cancelled);
  return {
    page,
    client: client as unknown as Record<"listSubmissions" | "readSubmissionDetail", ReturnType<typeof vi.fn>>,
    sent,
    pending,
    advance: (ms: number) => void (now += ms),
    setActive: (value: boolean) => void (active = value),
    /** Runs the next scheduled tick and waits for it to settle. */
    async tick() {
      const [task] = pending();
      task!.cancelled = true;
      now += task!.ms;
      task!.run();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const current = (overrides: Partial<PracticeSessionDto> | null = {}, capture: Partial<PracticeSessionDto["capture"]> = {}) => ({
  ok: true,
  response: { problem, session: overrides ? session(overrides, capture) : null, pendingRating: null },
});

describe("page session", () => {
  it("shows the sign-in state, or the problem and its session, without tracking another tab's session", async () => {
    const signedOut = harness({ respond: () => ({ ok: false, error: "signed_out" }) });
    await signedOut.page.refresh();
    expect(signedOut.page.view()).toEqual({ kind: "signed_out" });

    const elsewhere = harness({ respond: () => current({ ownership: "other_tab" }) });
    await elsewhere.page.refresh();
    expect(elsewhere.page.view()).toMatchObject({ kind: "ready", session: { ownership: "other_tab" } });
    expect(elsewhere.pending()).toHaveLength(0);
  });

  it("starts with the problem, LeetCode account, and newest submission as the baseline, then tracks", async () => {
    const h = harness({
      listing: () => ({ availability: "available", value: { complete: false, submissions: [{ id: "1000", verdict: "Accepted", pending: false, submittedAt: START, language: "python3" }] } }),
      respond: (message) => (message.type === "session_start" ? { ok: true, response: { ok: true, created: true, problem, session: session() } } : { ok: true, response: {} }),
    });
    await h.page.start("due_review");
    expect(h.sent[0]).toMatchObject({
      type: "session_start", slug: "two-sum", mode: "due_review", sourceAccount: "leet_user",
      baseline: { state: "established", leetcodeSubmissionId: "1000" }, supersedePendingRating: false, problem: { leetcodeSlug: "two-sum" },
    });
    expect(h.page.view()).toMatchObject({ kind: "ready", session: { id: "s1" }, busy: null });
    expect(h.pending()).toHaveLength(1);
    expect(h.pending()[0]!.ms).toBe(TICK_MS);
  });

  it("records no baseline and shows tracking as unavailable when LeetCode is signed out", async () => {
    const h = harness({
      listing: () => ({ availability: "signed_out", value: null }),
      accountAvailability: "signed_out",
      respond: (message) => (message.type === "session_start" ? { ok: true, response: { ok: true, created: true, problem, session: session({}, { baselineState: "unavailable", baselineSubmissionId: null }) } } : { ok: true, response: {} }),
    });
    await h.page.start("practice");
    expect(h.sent[0]).toMatchObject({ baseline: { state: "unavailable" } });
    expect(h.sent[0]).not.toHaveProperty("sourceAccount");
    expect(h.page.view()).toMatchObject({ availability: "signed_out" });
  });

  it("reports new submissions and activity every tick while visible", async () => {
    const h = harness({
      listing: () => ({ availability: "available", value: { complete: true, submissions: [{ id: "1001", verdict: "Wrong Answer", pending: false, submittedAt: START, language: "python3" }] } }),
      respond: (message) => (message.type === "page_state" ? current() : message.type === "session_activity" ? { ok: true, response: { ok: true, session: session({ revision: 3 }) } } : { ok: true, response: {} }),
    });
    await h.page.refresh();
    await h.tick();
    expect(h.sent.map((message) => message.type)).toEqual(["page_state", "session_observations", "session_activity"]);
    expect(h.sent[1]).toMatchObject({ sessionId: "s1", observations: [{ leetcodeSubmissionId: "1001", verdict: "Wrong Answer", detail: { code: "pass" } }] });
    expect(h.sent[2]).toMatchObject({ sessionId: "s1", activeMs: TICK_MS, observedMs: TICK_MS, availability: "available" });
    expect(h.page.view()).toMatchObject({ session: { revision: 3 } });
    expect(h.pending()).toHaveLength(1);
  });

  it("stops polling a hidden page but keeps the lease, and backs off while LeetCode is unreadable", async () => {
    const h = harness({
      listing: () => ({ availability: "unavailable", value: null }),
      respond: (message) => (message.type === "page_state" ? current() : { ok: true, response: { ok: true, session: session() } }),
    });
    const settle = async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await h.page.refresh();
    await settle();
    // Tracking checks LeetCode once as it starts; that read fails and backs off.
    expect(h.client.listSubmissions).toHaveBeenCalledTimes(1);
    expect(h.page.view()).toMatchObject({ availability: "unavailable" });

    h.setActive(false);
    h.page.onVisibilityChange();
    await h.tick();
    expect(h.client.listSubmissions).toHaveBeenCalledTimes(1);
    expect(h.sent.at(-1)).toMatchObject({ type: "session_activity", activeMs: 0, observedMs: TICK_MS });

    // Regaining focus checks at once, then the doubled backoff applies.
    h.setActive(true);
    h.page.onVisibilityChange();
    await settle();
    expect(h.client.listSubmissions).toHaveBeenCalledTimes(2);
    await h.tick();
    expect(h.client.listSubmissions).toHaveBeenCalledTimes(2);
  });

  it("gets a baseline for a session opened from the popup once the page loads", async () => {
    const h = harness({
      listing: () => ({ availability: "available", value: { complete: true, submissions: [{ id: "990", verdict: "Accepted", pending: false, submittedAt: START, language: "python3" }] } }),
      respond: (message) =>
        message.type === "page_state"
          ? current({}, { baselineState: "pending", baselineSubmissionId: null })
          : message.type === "session_control"
            ? { ok: true, response: { ok: true, session: session() } }
            : { ok: true, response: { ok: true, session: session() } },
    });
    await h.page.refresh();
    await h.tick();
    expect(h.sent.find((message) => message.type === "session_control")).toMatchObject({
      control: { command: "set_baseline", baseline: { state: "established", leetcodeSubmissionId: "990" } },
    });
  });

  it("returns to the server's view when another tab takes over", async () => {
    let tookOver = false;
    const h = harness({
      respond: (message) => {
        if (message.type === "page_state") return current(tookOver ? { ownership: "other_tab" } : {});
        if (message.type === "session_activity") {
          tookOver = true;
          return { ok: false, error: "not_owner" };
        }
        return { ok: true, response: {} };
      },
    });
    await h.page.refresh();
    await h.tick();
    expect(h.page.view()).toMatchObject({ session: { ownership: "other_tab" } });
    expect(h.pending()).toHaveLength(0);
  });

  it("polls once more before Finish, then offers the rating and stops tracking", async () => {
    const finished = session({ status: "completed", outcome: "accepted", ownership: "none", rating: { disposition: "pending", expiresAt: START } });
    const h = harness({
      respond: (message) =>
        message.type === "page_state" ? current()
          : message.type === "session_control" ? { ok: true, response: { ok: true, session: finished } }
            : { ok: true, response: { ok: true, session: session() } },
    });
    await h.page.refresh();
    h.advance(5_000);
    await h.page.finish("solved");
    expect(h.client.listSubmissions).toHaveBeenCalledTimes(1);
    expect(h.sent.map((message) => message.type)).toEqual(["page_state", "session_activity", "session_control"]);
    expect(h.sent.at(-1)).toMatchObject({ control: { command: "finish", result: "solved", occurredAt: new Date(Date.parse(START) + 5_000).toISOString() } });
    expect(h.page.view()).toMatchObject({ session: { status: "completed" }, pendingRating: { id: "s1" }, busy: null });
    expect(h.pending()).toHaveLength(0);
  });

  it("tells the user when an action was saved for later sync, and shows the next review after rating", async () => {
    const pendingSession = session({ status: "completed", ownership: "none", rating: { disposition: "pending", expiresAt: START } });
    const h = harness({
      respond: (message) =>
        message.type === "page_state"
          ? { ok: true, response: { problem, session: null, pendingRating: pendingSession } }
          : message.type === "session_rating"
            ? { ok: true, queued: false, response: { ok: true, session: pendingSession, problem, nextDue: "2026-10-02T12:00:00.000Z", idempotentReplay: false } }
            : { ok: true, queued: true },
    });
    await h.page.refresh();
    await h.page.rate(3);
    expect(h.sent.at(-1)).toEqual({ type: "session_rating", sessionId: "s1", rating: 3 });
    expect(h.page.view()).toMatchObject({ pendingRating: null, notice: { kind: "rated", nextDue: "2026-10-02T12:00:00.000Z" } });
  });
});
