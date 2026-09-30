import type {
  LeetcodeAvailability,
  PracticeModeId,
  PracticeProblemStatusDto,
  PracticeSessionCommandResponseDto,
  PracticeSessionCurrentDto,
  PracticeSessionDto,
  PracticeSessionErrorCode,
  PracticeSessionRatingResponseDto,
  PracticeSessionStartResponseDto,
  PracticeSessionSubmissionsResponseDto,
  PublicAiJobDto,
  SessionAnalysisStateDto,
  SessionBaselineInput,
  SkillDimensionId,
} from "@ankify/contracts";
import type { ContentMessage } from "../shared/protocol";
import { createActivityMeter } from "./activity-meter";
import type { LeetcodeClient } from "./leetcode-client";
import { createSubmissionPoller } from "./submission-poller";

export const TICK_MS = 15_000;
/** How often a running analysis is checked, and for how long at most. */
export const ANALYSIS_POLL_MS = 4_000;
const ANALYSIS_POLL_LIMIT_MS = 5 * 60_000;
const MAX_POLL_BACKOFF_MS = 5 * 60_000;
const FOCUS_POLL_DEBOUNCE_MS = 3_000;

export type BackgroundFailure = {
  ok: false;
  error: PracticeSessionErrorCode | "signed_out" | "offline" | "rate_limited" | "server_error" | "unexpected" | "invalid_message";
  session?: PracticeSessionDto;
};
export type BackgroundOutcome<T> = { ok: true; response: T; queued?: false } | { ok: true; queued: true } | BackgroundFailure;

/** Something the panel should tell the user about the last action. */
export type PageNotice =
  | { kind: "error"; error: BackgroundFailure["error"]; session?: PracticeSessionDto }
  | { kind: "queued"; action: "finish" | "abandon" | "rating" | "rating_decision" }
  | { kind: "rated"; nextDue: string | null };

/** The analysis of the page's latest finished session. */
export type AnalysisView = {
  sessionId: string;
  state: SessionAnalysisStateDto | null;
  busy: "loading" | "starting" | "deciding" | null;
  /** An error code from the last analysis action. */
  error: string | null;
};

export type PageView =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "offline" }
  | {
      kind: "ready";
      problem: PracticeProblemStatusDto | null;
      session: PracticeSessionDto | null;
      pendingRating: PracticeSessionDto | null;
      /** What LeetCode tracking could read last; anything but `available` is shown. */
      availability: LeetcodeAvailability;
      busy: "starting" | "finishing" | "abandoning" | "rating" | "claiming" | null;
      notice: PageNotice | null;
      /** The latest session completed in the last week, which analysis refers to. */
      recentCompleted: PracticeSessionDto | null;
      analysis: AnalysisView | null;
    };

type Scheduler = (task: () => void, ms: number) => () => void;

export type PageSessionDeps = {
  slug: string;
  client: LeetcodeClient;
  send: <T>(message: ContentMessage) => Promise<BackgroundOutcome<T>>;
  now: () => number;
  isActive: () => boolean;
  schedule: Scheduler;
};

/**
 * Session state for one LeetCode problem page. The page tracks a session only
 * while this tab controls it: every tick it samples activity, polls LeetCode
 * for new submissions (while visible, backing off when unavailable), and
 * renews the lease. Starting establishes the submission baseline first; a
 * session opened from the popup gets its baseline once the page loads.
 */
export function createPageSession(deps: PageSessionDeps) {
  let view: PageView = { kind: "loading" };
  const listeners = new Set<(view: PageView) => void>();
  let tracking: {
    sessionId: string;
    cancel: () => void;
    poller: ReturnType<typeof createSubmissionPoller>;
    meter: ReturnType<typeof createActivityMeter>;
    failures: number;
    nextPollAt: number;
    baselineRequested: boolean;
  } | null = null;
  let disposed = false;
  let lastFocusPollAt = Number.NEGATIVE_INFINITY;

  function set(next: PageView) {
    view = next;
    for (const listener of listeners) listener(view);
  }

  function ready(patch: Partial<Extract<PageView, { kind: "ready" }>>) {
    const base: Extract<PageView, { kind: "ready" }> =
      view.kind === "ready"
        ? view
        : { kind: "ready", problem: null, session: null, pendingRating: null, availability: "available", busy: null, notice: null, recentCompleted: null, analysis: null };
    set({ ...base, ...patch });
    syncTracking();
    syncAnalysis();
  }

  let analysisPoll: { cancel: () => void; until: number } | null = null;

  /** A finished session to analyze; none while a session is in progress. */
  function analysisTarget() {
    if (view.kind !== "ready") return null;
    const open = view.session && (view.session.status === "active" || view.session.status === "interrupted") && !view.session.stale;
    if (open) return null;
    return view.pendingRating ?? view.recentCompleted;
  }

  function setAnalysis(analysis: AnalysisView | null) {
    if (view.kind !== "ready") return;
    set({ ...view, analysis });
  }

  function syncAnalysis() {
    const target = analysisTarget();
    const current = view.kind === "ready" ? view.analysis : null;
    if ((target?.id ?? null) === (current?.sessionId ?? null)) return;
    stopAnalysisPoll();
    if (!target) return setAnalysis(null);
    setAnalysis({ sessionId: target.id, state: null, busy: "loading", error: null });
    void loadAnalysis(target.id);
  }

  function stopAnalysisPoll() {
    analysisPoll?.cancel();
    analysisPoll = null;
  }

  const jobActive = (job: PublicAiJobDto | null) => job?.status === "queued" || job?.status === "running";

  async function loadAnalysis(sessionId: string) {
    const result = await deps.send<SessionAnalysisStateDto>({ type: "analysis_state", sessionId });
    const current = view.kind === "ready" ? view.analysis : null;
    if (disposed || current?.sessionId !== sessionId) return;
    if (!result.ok) {
      setAnalysis({ ...current, busy: null, error: (result as { error: string }).error });
      // One failed read does not end the wait for a job that was running.
      return jobActive(current.state?.job ?? null) ? pollAnalysis(sessionId) : stopAnalysisPoll();
    }
    if (result.queued) return;
    setAnalysis({ ...current, state: result.response, busy: null, error: null });
    if (jobActive(result.response.job)) pollAnalysis(sessionId);
    else stopAnalysisPoll();
  }

  /** Checks again soon, for at most `ANALYSIS_POLL_LIMIT_MS` per wait. */
  function pollAnalysis(sessionId: string) {
    const until = analysisPoll?.until ?? deps.now() + ANALYSIS_POLL_LIMIT_MS;
    if (deps.now() >= until) return stopAnalysisPoll();
    analysisPoll = { until, cancel: deps.schedule(() => void loadAnalysis(sessionId), ANALYSIS_POLL_MS) };
  }

  function failureView(result: BackgroundFailure) {
    if (result.error === "signed_out") return set({ kind: "signed_out" });
    ready({ busy: null, notice: { kind: "error", error: result.error, ...(result.session ? { session: result.session } : {}) } });
  }

  const currentSession = () => (view.kind === "ready" ? view.session : null);

  function syncTracking() {
    const session = currentSession();
    const owned = session && session.status === "active" && session.ownership === "you" ? session : null;
    if (!owned) return stopTracking();
    if (tracking?.sessionId === owned.id) return;
    stopTracking();
    const sessionId = owned.id;
    const poller = createSubmissionPoller({
      client: deps.client,
      slug: deps.slug,
      session: () => {
        const latest = currentSession();
        return latest?.id === sessionId
          ? { baselineState: latest.capture.baselineState, baselineSubmissionId: latest.capture.baselineSubmissionId, startedAt: latest.timing.startedAt }
          : { baselineState: "unavailable", baselineSubmissionId: null, startedAt: owned.timing.startedAt };
      },
      report: async (observations) => {
        const result = await deps.send<PracticeSessionSubmissionsResponseDto>({ type: "session_observations", sessionId, observations });
        if (!result.ok && result.error !== "offline") throw new Error(result.error);
        // Show the new evidence at once rather than at the next heartbeat. Only
        // evidence is taken: observations carry no owner token, so the
        // response cannot say who controls the session.
        const latest = currentSession();
        if (result.ok && !result.queued && latest?.id === sessionId) {
          ready({ session: { ...latest, evidence: result.response.session.evidence, capture: result.response.session.capture } });
        }
      },
    });
    tracking = {
      sessionId,
      poller,
      meter: createActivityMeter({ now: deps.now, isActive: deps.isActive }),
      failures: 0,
      nextPollAt: 0,
      baselineRequested: false,
      cancel: () => undefined,
    };
    // Check at once: a session opened from the popup needs its baseline, and
    // a reloaded page may have missed submissions.
    void pollIfDue(true);
    loop();
  }

  function stopTracking() {
    tracking?.cancel();
    tracking = null;
  }

  function loop() {
    if (!tracking || disposed) return;
    const current = tracking;
    current.cancel = deps.schedule(() => {
      void tick().finally(() => {
        if (tracking === current) loop();
      });
    }, TICK_MS);
  }

  async function establishBaseline(): Promise<SessionBaselineInput> {
    const listing = await deps.client.listSubmissions(deps.slug, { maxPages: 1 });
    if (!listing.value || listing.availability !== "available") return { state: "unavailable" };
    const newest = listing.value.submissions[0];
    if (newest) return { state: "established", leetcodeSubmissionId: newest.id };
    return listing.value.complete ? { state: "none" } : { state: "unavailable" };
  }

  async function pollIfDue(force = false) {
    const current = tracking;
    if (!current || view.kind !== "ready") return;
    if (!force && (!deps.isActive() || deps.now() < current.nextPollAt)) return;
    const session = currentSession();
    if (session?.capture.baselineState === "pending" && !current.baselineRequested) {
      current.baselineRequested = true;
      // A session started from the popup also gets the page's LeetCode metadata.
      const [baseline, problem] = await Promise.all([establishBaseline(), deps.client.readProblem(deps.slug)]);
      const control = { command: "set_baseline" as const, baseline, ...(problem.availability === "available" && problem.value ? { problem: problem.value } : {}) };
      const result = await deps.send<PracticeSessionCommandResponseDto>({ type: "session_control", sessionId: current.sessionId, control });
      if (result.ok && !result.queued) ready({ session: result.response.session });
    }
    try {
      const { availability } = await current.poller.poll();
      const failed = availability === "signed_out" || availability === "unavailable";
      current.failures = failed ? current.failures + 1 : 0;
      current.nextPollAt = deps.now() + (failed ? Math.min(MAX_POLL_BACKOFF_MS, TICK_MS * 2 ** current.failures) : 0);
      if (view.kind === "ready" && view.availability !== availability) ready({ availability });
    } catch {
      current.failures += 1;
      current.nextPollAt = deps.now() + Math.min(MAX_POLL_BACKOFF_MS, TICK_MS * 2 ** current.failures);
    }
  }

  async function reportActivity() {
    const current = tracking;
    if (!current || view.kind !== "ready") return;
    current.meter.sample();
    const delta = current.meter.take();
    const result = await deps.send<PracticeSessionCommandResponseDto>({
      type: "session_activity",
      sessionId: current.sessionId,
      ...delta,
      availability: view.availability,
    });
    if (result.ok && !result.queued) {
      if (tracking === current) ready({ session: result.response.session });
    } else if (!result.ok && (result.error === "not_owner" || result.error === "session_stale" || result.error === "invalid_transition")) {
      // Another tab took over or the session ended elsewhere.
      await refresh();
    }
  }

  async function tick() {
    await pollIfDue();
    await reportActivity();
  }

  async function refresh() {
    const result = await deps.send<PracticeSessionCurrentDto>({ type: "page_state", slug: deps.slug });
    if (disposed) return;
    if (!result.ok) {
      if (result.error === "signed_out") return set({ kind: "signed_out" });
      if (result.error === "offline" && view.kind !== "ready") return set({ kind: "offline" });
      return failureView(result);
    }
    if (result.queued) return;
    const { problem, session, pendingRating, recentCompleted } = result.response;
    ready({ problem, session, pendingRating, recentCompleted });
  }

  function claimed(result: BackgroundOutcome<PracticeSessionCommandResponseDto>) {
    if (!result.ok) return failureView(result);
    if (result.queued) return ready({ busy: null });
    ready({ session: result.response.session, busy: null, notice: null });
  }

  return {
    view: () => view,
    subscribe(listener: (view: PageView) => void) {
      listeners.add(listener);
      listener(view);
      return () => listeners.delete(listener);
    },
    refresh,

    /** Reads the problem, LeetCode account, and baseline, then starts on the server. */
    async start(mode: PracticeModeId, options: { supersedePendingRating?: boolean } = {}) {
      ready({ busy: "starting", notice: null });
      const [problem, accountRead, baseline] = await Promise.all([
        deps.client.readProblem(deps.slug),
        deps.client.readAccount(),
        establishBaseline(),
      ]);
      if (!problem.value) return failureView({ ok: false, error: "unexpected" });
      const result = await deps.send<PracticeSessionStartResponseDto>({
        type: "session_start",
        slug: deps.slug,
        mode,
        problem: problem.value,
        baseline,
        ...(accountRead.value ? { sourceAccount: accountRead.value.username } : {}),
        supersedePendingRating: options.supersedePendingRating ?? false,
      });
      if (!result.ok) return failureView(result);
      if (result.queued) return;
      ready({
        problem: result.response.problem,
        session: result.response.session,
        pendingRating: null,
        availability: baseline.state === "unavailable" ? accountRead.availability === "signed_out" ? "signed_out" : "unavailable" : "available",
        busy: null,
        notice: null,
      });
    },

    async takeover() {
      const session = currentSession();
      if (!session) return;
      ready({ busy: "claiming", notice: null });
      claimed(await deps.send({ type: "session_control", sessionId: session.id, control: { command: "takeover" } }));
    },

    async resume() {
      const session = currentSession();
      if (!session) return;
      ready({ busy: "claiming", notice: null });
      claimed(await deps.send({ type: "session_control", sessionId: session.id, control: { command: "resume" } }));
    },

    /** Reports every submission LeetCode shows first, so the outcome reflects them. */
    async finish(result: "solved" | "unsuccessful") {
      const session = currentSession();
      if (!session) return;
      ready({ busy: "finishing", notice: null });
      await pollIfDue(true);
      await reportActivity().catch(() => undefined);
      const response = await deps.send<PracticeSessionCommandResponseDto>({
        type: "session_control",
        sessionId: session.id,
        control: { command: "finish", result, occurredAt: new Date(deps.now()).toISOString() },
      });
      stopTracking();
      if (!response.ok) return failureView(response);
      if (response.queued) return ready({ busy: null, session: { ...session, status: "completed" }, notice: { kind: "queued", action: "finish" } });
      const finished = response.response.session;
      ready({ session: finished, pendingRating: finished.rating.disposition === "pending" ? finished : null });
      // Finishing can schedule the problem (initial learning); read it back.
      await refresh();
      ready({ busy: null, notice: null });
    },

    async abandon() {
      const session = currentSession();
      if (!session) return;
      ready({ busy: "abandoning", notice: null });
      const response = await deps.send<PracticeSessionCommandResponseDto>({
        type: "session_control",
        sessionId: session.id,
        control: { command: "abandon", occurredAt: new Date(deps.now()).toISOString() },
      });
      stopTracking();
      if (!response.ok) return failureView(response);
      if (response.queued) return ready({ busy: null, session: null, notice: { kind: "queued", action: "abandon" } });
      await refresh();
      ready({ busy: null, notice: null });
    },

    async rate(rating: 1 | 2 | 3 | 4) {
      const pending = view.kind === "ready" ? view.pendingRating : null;
      if (!pending) return;
      ready({ busy: "rating", notice: null });
      const response = await deps.send<PracticeSessionRatingResponseDto>({ type: "session_rating", sessionId: pending.id, rating });
      if (!response.ok) {
        failureView(response);
        return refresh();
      }
      if (response.queued) return ready({ busy: null, pendingRating: null, notice: { kind: "queued", action: "rating" } });
      ready({ busy: null, pendingRating: null, problem: response.response.problem, notice: { kind: "rated", nextDue: response.response.nextDue } });
    },

    async decideRating(decision: "defer" | "dismiss") {
      const pending = view.kind === "ready" ? view.pendingRating : null;
      if (!pending) return;
      ready({ busy: "rating", notice: null });
      const response = await deps.send<PracticeSessionCommandResponseDto>({ type: "session_rating_decision", sessionId: pending.id, decision });
      if (!response.ok) return failureView(response);
      ready({ busy: null, pendingRating: null, notice: response.queued ? { kind: "queued", action: "rating_decision" } : null });
    },

    /** Starts an analysis of the latest finished session (the user's own key). */
    async analyze() {
      const current = view.kind === "ready" ? view.analysis : null;
      if (!current || current.busy) return;
      setAnalysis({ ...current, busy: "starting", error: null });
      const result = await deps.send<PublicAiJobDto>({ type: "analysis_start", sessionId: current.sessionId });
      const latest = view.kind === "ready" ? view.analysis : null;
      if (latest?.sessionId !== current.sessionId) return;
      if (!result.ok) return setAnalysis({ ...latest, busy: null, error: (result as { error: string }).error });
      stopAnalysisPoll();
      await loadAnalysis(current.sessionId);
    },

    /** Confirms (optionally recategorized) or dismisses a suggested finding. */
    async decideFinding(mistakeId: string, decision: "confirm" | "dismiss", category?: SkillDimensionId) {
      const current = view.kind === "ready" ? view.analysis : null;
      if (!current || current.busy) return;
      setAnalysis({ ...current, busy: "deciding", error: null });
      const result = await deps.send({ type: "analysis_finding", mistakeId, decision, ...(category ? { category } : {}) });
      const latest = view.kind === "ready" ? view.analysis : null;
      if (latest?.sessionId !== current.sessionId) return;
      if (!result.ok) return setAnalysis({ ...latest, busy: null, error: (result as { error: string }).error });
      await loadAnalysis(current.sessionId);
    },

    /** Visibility or focus changed: close the timing interval, and when the
     *  page is active again check LeetCode right away (debounced). */
    onVisibilityChange() {
      // An analysis still running after polling gave up is checked again.
      const analysis = view.kind === "ready" ? view.analysis : null;
      if (deps.isActive() && analysis && !analysisPoll && !analysis.busy && jobActive(analysis.state?.job ?? null)) {
        void loadAnalysis(analysis.sessionId);
      }
      const current = tracking;
      if (!current) return;
      current.meter.sample();
      if (!deps.isActive() || deps.now() - lastFocusPollAt < FOCUS_POLL_DEBOUNCE_MS) return;
      lastFocusPollAt = deps.now();
      current.nextPollAt = 0;
      void pollIfDue();
    },

    dispose() {
      disposed = true;
      stopTracking();
      stopAnalysisPoll();
      listeners.clear();
    },
  };
}

export type PageSession = ReturnType<typeof createPageSession>;
