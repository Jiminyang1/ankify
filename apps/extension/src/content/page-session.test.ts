import type { PracticeSessionDto, PublicAiJobDto, SessionAnalysisStateDto } from "@ankify/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ContentMessage } from "../shared/protocol";
import type { LeetcodeClient, ListedSubmission, Read } from "./leetcode-client";
import { ANALYSIS_POLL_MS, createPageSession, LATE_VERDICT_MS, SUBMIT_POLL_MS, SUBMIT_WATCH_MS, TICK_MS } from "./page-session";

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
  /** Visible without focus when set; follows `active` otherwise. */
  let visible: boolean | null = null;
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
    isVisible: () => visible ?? active,
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
    setVisible: (value: boolean | null) => void (visible = value),
    /** Runs the next scheduled task (of that delay, when given) and waits for it to settle. */
    async tick(ms?: number) {
      const task = pending().find((candidate) => ms == null || candidate.ms === ms);
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
      control: { command: "set_baseline", baseline: { state: "established", leetcodeSubmissionId: "990" }, problem: { leetcodeSlug: "two-sum", title: "Two Sum" } },
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
    let done = false;
    const h = harness({
      respond: (message) => {
        if (message.type === "page_state") return done ? { ok: true, response: { problem, session: null, pendingRating: finished } } : current();
        if (message.type === "session_control") {
          done = true;
          return { ok: true, response: { ok: true, session: finished } };
        }
        return { ok: true, response: { ok: true, session: session() } };
      },
    });
    await h.page.refresh();
    h.advance(5_000);
    await h.page.finish("solved");
    expect(h.client.listSubmissions).toHaveBeenCalledTimes(1);
    // The finished session's analysis state loads as soon as it is offered.
    expect(h.sent.map((message) => message.type)).toEqual(["page_state", "session_activity", "session_control", "analysis_state", "page_state"]);
    expect(h.sent[3]).toEqual({ type: "analysis_state", sessionId: "s1" });
    expect(h.sent[2]).toMatchObject({ control: { command: "finish", result: "solved", occurredAt: new Date(Date.parse(START) + 5_000).toISOString() } });
    expect(h.page.view()).toMatchObject({ session: null, pendingRating: { id: "s1" }, busy: null });
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

const settleAll = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const listed = (id: string, verdict: ListedSubmission["verdict"], pending = false): ListedSubmission =>
  ({ id, verdict, pending, submittedAt: START, language: "python3" });

describe("live submission tracking", () => {
  it("polls a visible page even when LeetCode's result view has focus", async () => {
    const h = harness({ respond: (message) => (message.type === "page_state" ? current() : { ok: true, response: { ok: true, session: session() } }) });
    await h.page.refresh();
    await settleAll();
    h.setActive(false);
    h.setVisible(true);
    await h.tick(TICK_MS);
    // The start check, then the tick: polling only needs the page visible.
    expect(h.client.listSubmissions).toHaveBeenCalledTimes(2);
  });

  it("checks every few seconds after a submit, shows a submission being judged, and stops once its verdict is in", async () => {
    let submissions: ListedSubmission[] = [];
    const judged = session({ evidence: { submissions: 1, accepted: 0, failed: 1, pendingDetails: 0, ambiguous: 0, firstAcceptedAt: null } });
    const h = harness({
      listing: () => ({ availability: "available", value: { complete: true, submissions } }),
      respond: (message) =>
        message.type === "page_state"
          ? current()
          : message.type === "session_observations"
            ? { ok: true, queued: false, response: { ok: true, session: judged, results: [] } }
            : { ok: true, response: { ok: true, session: session() } },
    });
    await h.page.refresh();
    await settleAll();
    h.page.onSubmitIntent();
    expect(h.pending().map((task) => task.ms)).toEqual([TICK_MS, SUBMIT_POLL_MS]);

    submissions = [listed("1001", "Other", true)];
    await h.tick(SUBMIT_POLL_MS);
    expect(h.page.view()).toMatchObject({ local: { judging: 1, unsynced: [] }, session: { evidence: { submissions: 0 } } });
    expect(h.sent.some((message) => message.type === "session_observations")).toBe(false);

    submissions = [listed("1001", "Wrong Answer")];
    await h.tick(SUBMIT_POLL_MS);
    expect(h.page.view()).toMatchObject({ local: { judging: 0 }, session: { evidence: { submissions: 1, failed: 1 } } });
    expect(h.sent.filter((message) => message.type === "session_observations")).toHaveLength(1);
    // The verdict is in: back to the regular tick.
    expect(h.pending().map((task) => task.ms)).toEqual([TICK_MS]);
  });

  it("stops watching a submit after a while when nothing new appears", async () => {
    const h = harness({ respond: (message) => (message.type === "page_state" ? current() : { ok: true, response: { ok: true, session: session() } }) });
    await h.page.refresh();
    await settleAll();
    h.page.onSubmitIntent();
    for (let elapsed = 0; elapsed < SUBMIT_WATCH_MS; elapsed += SUBMIT_POLL_MS) await h.tick(SUBMIT_POLL_MS);
    expect(h.pending().map((task) => task.ms)).toEqual([TICK_MS]);
  });

  it("shows submissions saved for later sync instead of none, until the outbox has delivered them", async () => {
    let delivered = false;
    const synced = session({ evidence: { submissions: 1, accepted: 1, failed: 0, pendingDetails: 0, ambiguous: 0, firstAcceptedAt: START } });
    const h = harness({
      listing: () => ({ availability: "available", value: { complete: true, submissions: [listed("1001", "Accepted")] } }),
      respond: (message) => {
        if (message.type === "page_state") {
          return delivered
            ? { ok: true, response: { problem, session: synced, pendingRating: null, localSync: { pendingObservations: 0 } } }
            : { ok: true, response: { problem, session: session(), pendingRating: null, localSync: { pendingObservations: 1 } } };
        }
        if (message.type === "session_observations") return { ok: true, queued: true };
        return { ok: true, response: { ok: true, session: session() } };
      },
    });
    await h.page.refresh();
    await settleAll();
    expect(h.page.view()).toMatchObject({ session: { evidence: { submissions: 0 } }, local: { unsynced: [{ id: "1001", accepted: true }] } });

    // Still waiting: a read keeps showing it.
    await h.page.refresh();
    expect(h.page.view()).toMatchObject({ local: { unsynced: [{ id: "1001" }] } });

    delivered = true;
    h.page.onExternalChange();
    await settleAll();
    expect(h.page.view()).toMatchObject({ session: { evidence: { submissions: 1, accepted: 1 } }, local: { unsynced: [] } });
  });

  it("reports a submission again when the worker could not take it", async () => {
    let unreachable = true;
    const h = harness({
      listing: () => ({ availability: "available", value: { complete: true, submissions: [listed("1001", "Wrong Answer")] } }),
      respond: (message) => {
        if (message.type === "page_state") return current();
        if (message.type === "session_observations") return unreachable ? { ok: false, error: "offline" } : { ok: true, queued: true };
        return { ok: true, response: { ok: true, session: session() } };
      },
    });
    await h.page.refresh();
    await settleAll();
    unreachable = false;
    h.page.onSubmitIntent();
    await h.tick(SUBMIT_POLL_MS);
    expect(h.sent.filter((message) => message.type === "session_observations")).toHaveLength(2);
    expect(h.page.view()).toMatchObject({ local: { unsynced: [{ id: "1001", accepted: false }] } });
  });
});

describe("rating after Finish", () => {
  const pendingSession = session({ status: "completed", ownership: "none", rating: { disposition: "pending", expiresAt: START } });

  it("offers another problem's unrated review instead of starting, and starts nothing until it is rated", async () => {
    const other = session({ id: "s-other", problemId: "p-other", status: "completed", ownership: "none", rating: { disposition: "pending", expiresAt: START } });
    const otherProblem = { ...problem, id: "p-other", leetcodeSlug: "add-two", title: "Add Two Numbers" };
    const h = harness({
      respond: (message) => {
        if (message.type === "page_state") return { ok: true, response: { problem, session: null, pendingRating: null } };
        if (message.type === "session_start") return { ok: false, error: "rating_pending", session: other, problem: otherProblem };
        if (message.type === "session_rating") return { ok: true, queued: false, response: { ok: true, session: other, problem: otherProblem, nextDue: START, idempotentReplay: false } };
        return { ok: true, response: {} };
      },
    });
    await h.page.refresh();
    await h.page.start("due_review");
    expect(h.sent.find((message) => message.type === "session_start")).toMatchObject({ supersedePendingRating: false });
    expect(h.page.view()).toMatchObject({ session: null, busy: null, notice: null, blockingRating: { session: { id: "s-other" }, problem: { title: "Add Two Numbers" } } });

    await h.page.rate(4);
    expect(h.sent.at(-1)).toEqual({ type: "session_rating", sessionId: "s-other", rating: 4 });
    expect(h.page.view()).toMatchObject({ blockingRating: null, notice: { kind: "unblocked" } });
  });

  it("treats a rating already given elsewhere as done, not as an error", async () => {
    let rated = false;
    const h = harness({
      respond: (message) => {
        if (message.type === "page_state") return { ok: true, response: { problem, session: null, pendingRating: rated ? null : pendingSession } };
        if (message.type === "session_rating") {
          rated = true;
          return { ok: false, error: "rating_not_pending" };
        }
        return { ok: true, response: {} };
      },
    });
    await h.page.refresh();
    await h.page.rate(3);
    expect(h.page.view()).toMatchObject({ pendingRating: null, notice: null, busy: null });
  });

  it("reports late verdicts of submissions judged at Finish, and no submission made after it", async () => {
    let submissions: ListedSubmission[] = [listed("1001", "Other", true)];
    const finished = session({ status: "completed", ownership: "none", rating: { disposition: "pending", expiresAt: START } });
    let done = false;
    const h = harness({
      listing: () => ({ availability: "available", value: { complete: true, submissions } }),
      respond: (message) => {
        if (message.type === "page_state") return done ? { ok: true, response: { problem, session: null, pendingRating: finished } } : current();
        if (message.type === "session_control") {
          done = true;
          return { ok: true, queued: false, response: { ok: true, session: finished } };
        }
        if (message.type === "session_observations") return { ok: true, queued: false, response: { ok: true, session: finished, results: [] } };
        return { ok: true, response: { ok: true, session: session() } };
      },
    });
    await h.page.refresh();
    await settleAll();
    await h.page.finish("solved");
    // The judged verdict arrives, and a new submission is made after Finish.
    submissions = [listed("1002", "Accepted"), listed("1001", "Wrong Answer")];
    await h.tick(SUBMIT_POLL_MS);
    const reported = h.sent.filter((message) => message.type === "session_observations");
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ sessionId: "s1", observations: [{ leetcodeSubmissionId: "1001", verdict: "Wrong Answer" }] });
    expect(h.pending()).toHaveLength(0);
  });

  it("stops waiting for late verdicts after a minute", async () => {
    const finished = session({ status: "completed", ownership: "none" });
    let done = false;
    const h = harness({
      listing: () => ({ availability: "available", value: { complete: true, submissions: [listed("1001", "Other", true)] } }),
      respond: (message) => {
        if (message.type === "page_state") return done ? { ok: true, response: { problem, session: null, pendingRating: null } } : current();
        if (message.type === "session_control") {
          done = true;
          return { ok: true, queued: false, response: { ok: true, session: finished } };
        }
        return { ok: true, response: { ok: true, session: session() } };
      },
    });
    await h.page.refresh();
    await settleAll();
    await h.page.finish("solved");
    for (let elapsed = 0; elapsed <= LATE_VERDICT_MS; elapsed += SUBMIT_POLL_MS) {
      if (!h.pending().some((task) => task.ms === SUBMIT_POLL_MS)) break;
      await h.tick(SUBMIT_POLL_MS);
    }
    expect(h.pending().filter((task) => task.ms === SUBMIT_POLL_MS)).toHaveLength(0);
  });
});

describe("connection and sign-in changes", () => {
  it("asks for a page reload once the extension was reloaded, and stops tracking", async () => {
    let reloaded = false;
    const h = harness({
      respond: (message) => {
        if (reloaded) return { ok: false, error: "extension_reloaded" };
        return message.type === "page_state" ? current() : { ok: true, response: { ok: true, session: session() } };
      },
    });
    await h.page.refresh();
    await settleAll();
    reloaded = true;
    await h.tick(TICK_MS);
    expect(h.page.view()).toEqual({ kind: "reload_required" });
    expect(h.pending()).toHaveLength(0);
  });

  it("says when ankify is unreachable during a session, and clears it when a heartbeat lands", async () => {
    let down = true;
    const h = harness({
      respond: (message) => {
        if (message.type === "page_state") return current();
        if (message.type === "session_activity") return down ? { ok: false, error: "server_error" } : { ok: true, response: { ok: true, session: session() } };
        return { ok: true, response: { ok: true, session: session() } };
      },
    });
    await h.page.refresh();
    await settleAll();
    await h.tick(TICK_MS);
    expect(h.page.view()).toMatchObject({ kind: "ready", reachable: false, session: { id: "s1" } });
    down = false;
    await h.tick(TICK_MS);
    expect(h.page.view()).toMatchObject({ reachable: true });
  });

  it("shows sign-in when the ankify session expires mid-session, and recovers when the page is visible again", async () => {
    let signedIn = true;
    const h = harness({
      respond: (message) => {
        if (!signedIn) return { ok: false, error: "signed_out" };
        return message.type === "page_state" ? current() : { ok: true, response: { ok: true, session: session() } };
      },
    });
    await h.page.refresh();
    await settleAll();
    signedIn = false;
    await h.tick(TICK_MS);
    expect(h.page.view()).toEqual({ kind: "signed_out" });

    signedIn = true;
    h.advance(5_000);
    h.page.onVisibilityChange();
    await settleAll();
    expect(h.page.view()).toMatchObject({ kind: "ready", session: { id: "s1" } });
  });
});

describe("state changed elsewhere", () => {
  it("re-reads when the popup rated the session, after any action under way here", async () => {
    const pendingSession = session({ status: "completed", ownership: "none", rating: { disposition: "pending", expiresAt: START } });
    let rated = false;
    let finishRating: (value: unknown) => void = () => undefined;
    const h = harness({
      respond: (message) => {
        if (message.type === "page_state") return { ok: true, response: { problem, session: null, pendingRating: rated ? null : pendingSession } };
        if (message.type === "session_rating_decision") return new Promise((resolve) => (finishRating = resolve));
        return { ok: true, response: {} };
      },
    });
    await h.page.refresh();
    expect(h.page.view()).toMatchObject({ pendingRating: { id: "s1" } });

    // Busy here: the nudge waits for the action to end.
    const deciding = h.page.skipRating();
    h.page.onExternalChange();
    expect(h.sent.filter((message) => message.type === "page_state")).toHaveLength(1);
    rated = true;
    finishRating({ ok: false, error: "rating_not_pending" });
    await deciding;
    await settleAll();
    expect(h.sent.filter((message) => message.type === "page_state").length).toBeGreaterThanOrEqual(2);
    expect(h.page.view()).toMatchObject({ pendingRating: null });
  });

  it("ignores a read that a later one overtook", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const h = harness({ respond: (message) => (message.type === "page_state" ? new Promise((resolve) => answers.push(resolve)) : { ok: true, response: {} }) });
    const first = h.page.refresh();
    const second = h.page.refresh();
    answers[1]!(current({ revision: 5 }));
    await second;
    answers[0]!(current({ revision: 2 }));
    await first;
    expect(h.page.view()).toMatchObject({ session: { revision: 5 } });
  });
});

describe("session analysis on the page", () => {
  const finished = session({ status: "completed", outcome: "accepted", ownership: "none" });
  const analysisState = (status: PublicAiJobDto["status"] | null): SessionAnalysisStateDto => ({
    analysis: null,
    job: status ? ({ id: "job-1", status, practiceSessionId: "s1", trigger: "manual" } as PublicAiJobDto) : null,
    findings: [],
    manual: { available: true },
  });
  /** Answers `analysis_state` from a script, one entry per request. */
  function analysisHarness(script: unknown[], pageState: Record<string, unknown> = { problem, session: null, pendingRating: null, recentCompleted: finished }) {
    const reads = [...script];
    return harness({
      respond: (message) => {
        if (message.type === "page_state") return { ok: true, response: pageState };
        if (message.type === "analysis_state") return reads.shift() ?? { ok: true, response: analysisState(null) };
        if (message.type === "analysis_start") return { ok: false, error: "analysis_budget_exhausted" };
        return { ok: true, response: {} };
      },
    });
  }
  const settle = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const reads = (h: ReturnType<typeof harness>) => h.sent.filter((message) => message.type === "analysis_state").length;

  it("loads the latest finished session's analysis, polls while its job runs, and stops when it ends", async () => {
    const h = analysisHarness([{ ok: true, response: analysisState("queued") }, { ok: true, response: analysisState("running") }, { ok: true, response: analysisState("succeeded") }]);
    await h.page.refresh();
    await settle();
    expect(h.sent[1]).toEqual({ type: "analysis_state", sessionId: "s1" });
    expect(h.page.view()).toMatchObject({ analysis: { sessionId: "s1", busy: null, state: { job: { status: "queued" } } } });
    expect(h.pending().map((task) => task.ms)).toEqual([ANALYSIS_POLL_MS]);
    await h.tick();
    await h.tick();
    expect(h.page.view()).toMatchObject({ analysis: { state: { job: { status: "succeeded" } } } });
    expect(reads(h)).toBe(3);
    expect(h.pending()).toHaveLength(0);
  });

  it("keeps waiting through a failed read, gives up after five minutes, and checks again when the page is active", async () => {
    const running = { ok: true, response: analysisState("running") };
    const h = analysisHarness([running, { ok: false, error: "offline" }, running, running, running]);
    await h.page.refresh();
    await settle();
    await h.tick();
    expect(h.page.view()).toMatchObject({ analysis: { error: "offline", state: { job: { status: "running" } } } });
    expect(h.pending()).toHaveLength(1);
    await h.tick();
    expect(h.page.view()).toMatchObject({ analysis: { error: null } });

    h.advance(5 * 60_000);
    await h.tick();
    expect(h.pending()).toHaveLength(0);
    h.page.onVisibilityChange();
    await settle();
    expect(reads(h)).toBe(5);
    expect(h.pending().map((task) => task.ms)).toEqual([ANALYSIS_POLL_MS]);
  });

  it("offers no analysis while a session is in progress", async () => {
    const h = analysisHarness([], { problem, session: session(), pendingRating: null, recentCompleted: finished });
    await h.page.refresh();
    await settle();
    expect(reads(h)).toBe(0);
    expect(h.page.view()).toMatchObject({ analysis: null });
  });

  it("shows why a manual analysis did not start", async () => {
    const h = analysisHarness([{ ok: true, response: analysisState(null) }]);
    await h.page.refresh();
    await settle();
    await h.page.analyze();
    expect(h.sent.at(-1)).toEqual({ type: "analysis_start", sessionId: "s1" });
    expect(h.page.view()).toMatchObject({ analysis: { busy: null, error: "analysis_budget_exhausted" } });
    expect(h.pending()).toHaveLength(0);
  });
});
