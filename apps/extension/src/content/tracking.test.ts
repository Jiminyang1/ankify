import type { SessionObservationInput } from "@ankify/contracts";
import { describe, expect, it, vi } from "vitest";
import { createActivityMeter, MAX_OBSERVED_GAP_MS } from "./activity-meter";
import type { LeetcodeClient, ListedSubmission, Read, SubmissionDetail } from "./leetcode-client";
import { createSubmissionPoller, MAX_DETAIL_ATTEMPTS, type PollerSession } from "./submission-poller";

describe("activity meter", () => {
  it("attributes each interval to the state it began in and excludes long gaps", () => {
    let now = 0;
    let active = true;
    const meter = createActivityMeter({ now: () => now, isActive: () => active });
    // The tab is hidden at 10 s: the handler samples with the new state in effect.
    now = 10_000;
    active = false;
    meter.sample();
    now = 25_000;
    meter.sample();
    expect(meter.take()).toEqual({ activeMs: 10_000, observedMs: 25_000 });
    now += MAX_OBSERVED_GAP_MS + 1;
    meter.sample();
    expect(meter.take()).toEqual({ activeMs: 0, observedMs: 0 });
    now += 5_000;
    active = true;
    meter.sample();
    now += 5_000;
    meter.sample();
    expect(meter.take()).toEqual({ activeMs: 5_000, observedMs: 10_000 });
    expect(meter.take()).toEqual({ activeMs: 0, observedMs: 0 });
  });
});

function fakeClient(listing: () => Read<{ submissions: ListedSubmission[]; complete: boolean }>, details: (id: string) => Read<SubmissionDetail>) {
  return {
    listSubmissions: vi.fn(async () => listing()),
    readSubmissionDetail: vi.fn(async (id: string) => details(id)),
    readProblem: vi.fn(),
    readAccount: vi.fn(),
  } as unknown as LeetcodeClient & { listSubmissions: ReturnType<typeof vi.fn>; readSubmissionDetail: ReturnType<typeof vi.fn> };
}

const START = "2026-09-29T12:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(START) + seconds * 1000).toISOString();
const submission = (id: string, seconds: number, verdict: ListedSubmission["verdict"] = "Wrong Answer", pending = false): ListedSubmission =>
  ({ id, verdict, pending, submittedAt: at(seconds), language: "python3" });
const detail = (code: string): Read<SubmissionDetail> => ({ availability: "available", value: { language: "Python3", code } });
const reportMock = () => vi.fn(async (observations: SessionObservationInput[]) => {
  void observations;
});

describe("submission poller", () => {
  const established: PollerSession = { baselineState: "established", baselineSubmissionId: "1000", startedAt: START };

  it("reports new judged submissions oldest first, with details, and never twice", async () => {
    const client = fakeClient(
      () => ({ availability: "available", value: { complete: true, submissions: [submission("1003", 90, "Other", true), submission("1002", 60, "Accepted"), submission("1001", 30)] } }),
      (id) => detail(`code ${id}`),
    );
    const report = reportMock();
    const poller = createSubmissionPoller({ client, slug: "two-sum", session: () => established, report });
    expect(await poller.poll()).toEqual({ availability: "available", reported: 2 });
    expect(report).toHaveBeenCalledWith([
      { leetcodeSubmissionId: "1001", verdict: "Wrong Answer", submittedAt: at(30), detail: { language: "Python3", code: "code 1001" } },
      { leetcodeSubmissionId: "1002", verdict: "Accepted", submittedAt: at(60), detail: { language: "Python3", code: "code 1002" } },
    ]);
    expect(client.listSubmissions).toHaveBeenCalledWith("two-sum", { stopAtId: "1000", maxPages: 3 });
    expect(await poller.poll()).toEqual({ availability: "available", reported: 0 });
    expect(client.readSubmissionDetail).toHaveBeenCalledTimes(2);
  });

  it("reports the verdict at once and retries missing details before giving up on them", async () => {
    const client = fakeClient(() => ({ availability: "available", value: { complete: true, submissions: [submission("1001", 30)] } }), () => ({ availability: "partial", value: null }));
    const report = reportMock();
    const poller = createSubmissionPoller({ client, slug: "two-sum", session: () => established, report });
    for (let attempt = 1; attempt <= MAX_DETAIL_ATTEMPTS + 1; attempt += 1) await poller.poll();
    expect(report.mock.calls.map(([observations]) => observations)).toEqual([
      [{ leetcodeSubmissionId: "1001", verdict: "Wrong Answer", submittedAt: at(30) }],
      [{ leetcodeSubmissionId: "1001", verdict: "Wrong Answer", submittedAt: at(30), detailUnavailable: true }],
    ]);
    expect(client.readSubmissionDetail).toHaveBeenCalledTimes(MAX_DETAIL_ATTEMPTS);
  });

  it("retries on the next poll when the hand-off to the extension failed", async () => {
    const client = fakeClient(() => ({ availability: "available", value: { complete: true, submissions: [submission("1001", 30)] } }), (id) => detail(id));
    const report = vi.fn().mockRejectedValueOnce(new Error("worker restarting")).mockResolvedValue(undefined);
    const poller = createSubmissionPoller({ client, slug: "two-sum", session: () => established, report });
    await expect(poller.poll()).rejects.toThrow("worker restarting");
    expect(await poller.poll()).toMatchObject({ reported: 1 });
  });

  it("reports nothing when LeetCode cannot be read, and lets the server place submissions without a baseline", async () => {
    const report = reportMock();
    const unavailable = createSubmissionPoller({ client: fakeClient(() => ({ availability: "signed_out", value: null }), () => detail("x")), slug: "x", session: () => established, report });
    expect(await unavailable.poll()).toEqual({ availability: "signed_out", reported: 0 });

    const noBaseline = createSubmissionPoller({
      client: fakeClient(() => ({ availability: "available", value: { complete: false, submissions: [submission("7", 10), submission("6", -20), submission("5", -3600)] } }), () => detail("x")),
      slug: "x",
      session: () => ({ baselineState: "unavailable", baselineSubmissionId: null, startedAt: START }),
      report,
    });
    expect(await noBaseline.poll()).toMatchObject({ reported: 2 });
    expect(report.mock.calls.at(-1)![0].map((item) => item.leetcodeSubmissionId)).toEqual(["6", "7"]);
  });

  it("never runs two polls at once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = fakeClient(() => ({ availability: "available", value: { complete: true, submissions: [] } }), () => detail("x"));
    client.listSubmissions.mockImplementation(async () => {
      await gate;
      return { availability: "available", value: { complete: true, submissions: [] } };
    });
    const poller = createSubmissionPoller({ client, slug: "x", session: () => established, report: vi.fn() });
    const first = poller.poll();
    const second = poller.poll();
    release();
    expect(await first).toBe(await second);
    expect(client.listSubmissions).toHaveBeenCalledTimes(1);
  });
});
