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
/** After a submit (or while LeetCode is judging), LeetCode is checked this often. */
export const SUBMIT_POLL_MS = 2_000;
/** How long a submit is watched for before the regular tick takes over. */
export const SUBMIT_WATCH_MS = 45_000;
const JUDGING_WATCH_MS = 20_000;
/** After Finish, verdicts of submissions LeetCode was still judging are awaited this long. */
export const LATE_VERDICT_MS = 60_000;

export type BackgroundFailure = {
  ok: false;
  error:
    | PracticeSessionErrorCode
    | "signed_out"
    | "offline"
    | "rate_limited"
    | "server_error"
    | "unexpected"
    | "invalid_message"
    /** The extension was reloaded or updated; this page's script is orphaned. */
    | "extension_reloaded"
    /** The background worker did not answer. */
    | "extension_unavailable";
  session?: PracticeSessionDto;
  /** `session`'s problem, when it is another one (a review awaiting its rating). */
  problem?: PracticeProblemStatusDto;
};
export type BackgroundOutcome<T> = { ok: true; response: T; queued?: false } | { ok: true; queued: true } | BackgroundFailure;

/** Something the panel should tell the user about the last action. */
export type PageNotice =
  | { kind: "error"; error: BackgroundFailure["error"]; session?: PracticeSessionDto }
  | { kind: "queued"; action: "finish" | "abandon" | "rating" | "rating_decision" }
  | { kind: "rated"; nextDue: string | null }
  /** Another problem's review was rated or skipped; this one can start now. */
  | { kind: "unblocked" };

/** Submissions this page has seen that the server's evidence may not show yet. */
export type LocalEvidence = {
  /** New submissions LeetCode is still judging. */
  judging: number;
  /** Judged submissions saved in the outbox, not yet confirmed by the server. */
  unsynced: { id: string; accepted: boolean }[];
};

const NO_LOCAL_EVIDENCE: LocalEvidence = { judging: 0, unsynced: [] };

/** The page-state answer, plus how many of the session's observations wait in the outbox. */
export type PageStateResponse = PracticeSessionCurrentDto & { localSync?: { pendingObservations: number } };

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
  /** The extension was reloaded or updated: only reloading the page helps. */
  | { kind: "reload_required" }
  | {
      kind: "ready";
      problem: PracticeProblemStatusDto | null;
      session: PracticeSessionDto | null;
      pendingRating: PracticeSessionDto | null;
      /** Another problem's finished review that must be rated or skipped before a review starts here. */
      blockingRating: { session: PracticeSessionDto; problem: PracticeProblemStatusDto } | null;
      /** What LeetCode tracking could read last; anything but `available` is shown. */
      availability: LeetcodeAvailability;
      /** The tracked session's submissions seen here but not (yet) in its evidence. */
      local: LocalEvidence;
      /** Whether ankify answered the last heartbeat; work is saved locally meanwhile. */
      reachable: boolean;
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
  /** Visible and focused: counts as active practice time. */
  isActive: () => boolean;
  /** Visible: LeetCode is polled (defaults to `isActive`). */
  isVisible?: () => boolean;
  schedule: Scheduler;
};

/**
 * Session state for one LeetCode problem page. The page tracks a session only
 * while this tab controls it: every tick it samples activity, polls LeetCode
 * for new submissions (while visible, backing off when unavailable), and
 * renews the lease. A submit on the page (or a submission still being
 * judged) makes it check every few seconds until the verdict is in. Starting
 * establishes the submission baseline first; a session opened from the popup
 * gets its baseline once the page loads.
 */
export function createPageSession(deps: PageSessionDeps) {
  const isVisible = deps.isVisible ?? deps.isActive;

  /** Every request to the worker. An orphaned script stops for good. */
  async function send<T>(message: ContentMessage): Promise<BackgroundOutcome<T>> {
    const result = await deps.send<T>(message);
    if (!result.ok && result.error === "extension_reloaded" && !disposed) {
      stopTracking();
      late?.cancel();
      set({ kind: "reload_required" });
    }
    return result;
  }
  let view: PageView = { kind: "loading" };
  const listeners = new Set<(view: PageView) => void>();
  let tracking: {
    sessionId: string;
    cancel: () => void;
    poller: ReturnType<typeof createSubmissionPoller>;
    /** Narrows the poller to late verdicts once the session is finished. */
    filter: { ids: ReadonlySet<string> | null };
    meter: ReturnType<typeof createActivityMeter>;
    failures: number;
    nextPollAt: number;
    baselineRequested: boolean;
    /** Submissions LeetCode was judging at the last check. */
    judgingIds: string[];
  } | null = null;
  /** Polls for late verdicts after Finish. */
  let late: { cancel: () => void } | null = null;
  let disposed = false;
  let lastFocusPollAt = Number.NEGATIVE_INFINITY;
  /** Fast checks after a submit; ends at `until` or once the verdict is reported. */
  let watch: { until: number; cancel: () => void } | null = null;
  let refreshSeq = 0;
  let lastRecoverAt = Number.NEGATIVE_INFINITY;
  /** A change from elsewhere arrived during an action; read the state after it. */
  let refreshAfterBusy = false;

  function set(next: PageView) {
    view = next;
    for (const listener of listeners) listener(view);
  }

  function ready(patch: Partial<Extract<PageView, { kind: "ready" }>>) {
    const base: Extract<PageView, { kind: "ready" }> =
      view.kind === "ready"
        ? view
        : { kind: "ready", problem: null, session: null, pendingRating: null, blockingRating: null, availability: "available", local: NO_LOCAL_EVIDENCE, reachable: true, busy: null, notice: null, recentCompleted: null, analysis: null };
    set({ ...base, ...patch });
    syncTracking();
    syncAnalysis();
    if (patch.busy === null && refreshAfterBusy) {
      refreshAfterBusy = false;
      void refresh();
    }
  }

  const localEvidence = () => (view.kind === "ready" ? view.local : NO_LOCAL_EVIDENCE);

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
    const result = await send<SessionAnalysisStateDto>({ type: "analysis_state", sessionId });
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
    if (result.error === "extension_reloaded") return;
    if (result.error === "signed_out") return set({ kind: "signed_out" });
    ready({ busy: null, notice: { kind: "error", error: result.error, ...(result.session ? { session: result.session } : {}) } });
  }

  const currentSession = () => (view.kind === "ready" ? view.session : null);

  /** The rating the panel shows: this problem's, else the one blocking a start. */
  function ratingTarget() {
    if (view.kind !== "ready") return null;
    if (view.pendingRating) return { session: view.pendingRating, blocking: false };
    if (view.blockingRating) return { session: view.blockingRating.session, blocking: true };
    return null;
  }

  /** Rated or skipped elsewhere already (popup, another tab): show the
   *  current state instead of an error. Duplicates never reschedule. */
  async function ratingFailed(response: BackgroundFailure, target: { blocking: boolean }) {
    if (response.error === "rating_not_pending") {
      ready({ busy: null, notice: null, ...(target.blocking ? { blockingRating: null } : {}) });
      return refresh();
    }
    failureView(response);
    return refresh();
  }

  function syncTracking() {
    const session = currentSession();
    const owned = session && session.status === "active" && session.ownership === "you" ? session : null;
    if (!owned) return stopTracking();
    if (tracking?.sessionId === owned.id) return;
    stopTracking();
    const sessionId = owned.id;
    const filter: { ids: ReadonlySet<string> | null } = { ids: null };
    const poller = createSubmissionPoller({
      client: deps.client,
      slug: deps.slug,
      only: () => filter.ids,
      session: () => {
        const latest = currentSession();
        return latest?.id === sessionId
          ? { baselineState: latest.capture.baselineState, baselineSubmissionId: latest.capture.baselineSubmissionId, startedAt: latest.timing.startedAt }
          : { baselineState: "unavailable", baselineSubmissionId: null, startedAt: owned.timing.startedAt };
      },
      report: async (observations) => {
        const result = await send<PracticeSessionSubmissionsResponseDto>({ type: "session_observations", sessionId, observations });
        // Nothing was saved (the worker was unreachable, or Ankify is signed
        // out): failing the hand-off makes the poller report these again.
        if (!result.ok) throw new Error(result.error);
        const latest = currentSession();
        if (latest?.id !== sessionId) return;
        if (result.ok && !result.queued) {
          // Show the new evidence at once rather than at the next heartbeat.
          // Only evidence is taken: observations carry no owner token, so the
          // response cannot say who controls the session. The outbox keeps a
          // session's operations in order, so earlier saved ones landed too.
          ready({ session: { ...latest, evidence: result.response.session.evidence, capture: result.response.session.capture }, local: { ...localEvidence(), unsynced: [] } });
          return;
        }
        // Saved in the outbox for later: show them as waiting to sync rather
        // than as missing.
        const unsynced = [...localEvidence().unsynced];
        for (const observation of observations) {
          const id = observation.leetcodeSubmissionId ?? observation.clientObservationId ?? "";
          if (unsynced.some((item) => item.id === id)) continue;
          unsynced.push({ id, accepted: observation.verdict === "Accepted" });
        }
        ready({ local: { ...localEvidence(), unsynced } });
      },
    });
    if (view.kind === "ready") set({ ...view, local: NO_LOCAL_EVIDENCE });
    tracking = {
      sessionId,
      poller,
      filter,
      meter: createActivityMeter({ now: deps.now, isActive: deps.isActive }),
      failures: 0,
      nextPollAt: 0,
      baselineRequested: false,
      judgingIds: [],
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
    stopWatch();
  }

  /** Checks LeetCode every `SUBMIT_POLL_MS` for at least `ms` more. */
  function watchSubmissions(ms: number) {
    if (!tracking || disposed) return;
    const until = deps.now() + ms;
    if (watch) {
      watch.until = Math.max(watch.until, until);
      return;
    }
    const current = { until, cancel: () => undefined };
    watch = current;
    scheduleWatch(current);
  }

  function scheduleWatch(current: NonNullable<typeof watch>) {
    current.cancel = deps.schedule(() => {
      void pollIfDue(true).finally(() => {
        if (watch !== current) return;
        if (deps.now() >= current.until) watch = null;
        else scheduleWatch(current);
      });
    }, SUBMIT_POLL_MS);
  }

  function stopWatch() {
    watch?.cancel();
    watch = null;
  }

  /**
   * Finish freezes the session: no later submission joins it. Submissions
   * LeetCode was still judging at Finish were made before it, so their
   * verdicts are still reported, and only theirs, for a short while.
   */
  function awaitLateVerdicts(finished: NonNullable<typeof tracking>) {
    late?.cancel();
    late = null;
    if (finished.judgingIds.length === 0) return;
    finished.filter.ids = new Set(finished.judgingIds);
    const until = deps.now() + LATE_VERDICT_MS;
    const next = () => {
      late = {
        cancel: deps.schedule(() => {
          const again = (judging: number) => {
            if (disposed || judging === 0 || deps.now() >= until) late = null;
            else next();
          };
          finished.poller.poll().then((result) => again(result.judging), () => again(1));
        }, SUBMIT_POLL_MS),
      };
    };
    next();
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
    if (!force && (!isVisible() || deps.now() < current.nextPollAt)) return;
    const session = currentSession();
    if (session?.capture.baselineState === "pending" && !current.baselineRequested) {
      current.baselineRequested = true;
      // A session started from the popup also gets the page's LeetCode metadata.
      const [baseline, problem] = await Promise.all([establishBaseline(), deps.client.readProblem(deps.slug)]);
      const control = { command: "set_baseline" as const, baseline, ...(problem.availability === "available" && problem.value ? { problem: problem.value } : {}) };
      const result = await send<PracticeSessionCommandResponseDto>({ type: "session_control", sessionId: current.sessionId, control });
      if (result.ok && !result.queued) ready({ session: result.response.session });
    }
    try {
      const { availability, reported, judging, judgingIds } = await current.poller.poll();
      current.judgingIds = judgingIds;
      const failed = availability === "signed_out" || availability === "unavailable";
      current.failures = failed ? current.failures + 1 : 0;
      current.nextPollAt = deps.now() + (failed ? Math.min(MAX_POLL_BACKOFF_MS, TICK_MS * 2 ** current.failures) : 0);
      if (tracking !== current) return;
      if (view.kind === "ready" && (view.availability !== availability || view.local.judging !== judging)) {
        ready({ availability, local: { ...view.local, judging } });
      }
      // Keep checking while LeetCode judges; a submit is watched until its
      // verdict is reported, and not at all while LeetCode is signed out.
      if (availability === "signed_out") stopWatch();
      else if (judging > 0) watchSubmissions(JUDGING_WATCH_MS);
      else if (reported > 0) stopWatch();
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
    const result = await send<PracticeSessionCommandResponseDto>({
      type: "session_activity",
      sessionId: current.sessionId,
      ...delta,
      availability: view.availability,
    });
    if (result.ok && !result.queued) {
      if (tracking === current) ready({ session: result.response.session, reachable: true });
    } else if (!result.ok && (result.error === "not_owner" || result.error === "session_stale" || result.error === "invalid_transition")) {
      // Another tab took over or the session ended elsewhere.
      await refresh();
    } else if (!result.ok && result.error === "signed_out") {
      // The ankify session expired; tracking resumes once signed in again.
      set({ kind: "signed_out" });
    } else if (!result.ok && tracking === current && view.kind === "ready" && view.reachable) {
      // Outage or overload: submissions keep being saved for later sync.
      ready({ reachable: false });
    }
  }

  async function tick() {
    await pollIfDue();
    await reportActivity();
  }

  async function refresh() {
    const seq = ++refreshSeq;
    const result = await send<PageStateResponse>({ type: "page_state", slug: deps.slug });
    // A later read (or the page going away) supersedes this one.
    if (disposed || seq !== refreshSeq) return;
    if (!result.ok) {
      if (result.error === "extension_reloaded") return;
      if (result.error === "signed_out") return set({ kind: "signed_out" });
      if (view.kind !== "ready" && (result.error === "offline" || result.error === "server_error" || result.error === "rate_limited" || result.error === "extension_unavailable")) {
        return set({ kind: "offline" });
      }
      return failureView(result);
    }
    if (result.queued) return;
    const { problem, pendingRating, recentCompleted, localSync } = result.response;
    // An action's answer may be newer than a read that was already under way.
    const shown = currentSession();
    const session = result.response.session && shown?.id === result.response.session.id && shown.revision > result.response.session.revision ? shown : result.response.session;
    const local = localSync?.pendingObservations === 0 ? { ...localEvidence(), unsynced: [] } : localEvidence();
    ready({ problem, session, pendingRating, recentCompleted, local, reachable: true });
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

    /** The session changed elsewhere (the popup, another tab, a delayed sync):
     *  read the authoritative state, after any action under way here. */
    onExternalChange() {
      if (disposed) return;
      if (view.kind === "ready" && view.busy != null) {
        refreshAfterBusy = true;
        return;
      }
      void refresh();
    },

    /** The user pressed LeetCode's Submit: watch for the new submission. */
    onSubmitIntent() {
      watchSubmissions(SUBMIT_WATCH_MS);
    },

    /** Reads the problem, LeetCode account, and baseline, then starts on the server. */
    async start(mode: PracticeModeId) {
      ready({ busy: "starting", notice: null });
      const [problem, accountRead, baseline] = await Promise.all([
        deps.client.readProblem(deps.slug),
        deps.client.readAccount(),
        establishBaseline(),
      ]);
      if (!problem.value) return failureView({ ok: false, error: "unexpected" });
      const result = await send<PracticeSessionStartResponseDto>({
        type: "session_start",
        slug: deps.slug,
        mode,
        problem: problem.value,
        baseline,
        ...(accountRead.value ? { sourceAccount: accountRead.value.username } : {}),
        // A pending rating is rated or skipped first, never discarded by a start.
        supersedePendingRating: false,
      });
      if (!result.ok) {
        if (result.error === "rating_pending" && result.session && result.problem) {
          // Another problem's review needs its rating first; offer it here.
          return ready({ busy: null, notice: null, blockingRating: { session: result.session, problem: result.problem } });
        }
        // This problem's own pending rating: show it.
        if (result.error === "rating_pending") return refresh().then(() => ready({ busy: null }));
        return failureView(result);
      }
      if (result.queued) return;
      ready({
        problem: result.response.problem,
        session: result.response.session,
        pendingRating: null,
        blockingRating: null,
        availability: baseline.state === "unavailable" ? accountRead.availability === "signed_out" ? "signed_out" : "unavailable" : "available",
        busy: null,
        notice: null,
      });
    },

    async takeover() {
      const session = currentSession();
      if (!session) return;
      ready({ busy: "claiming", notice: null });
      claimed(await send({ type: "session_control", sessionId: session.id, control: { command: "takeover" } }));
    },

    async resume() {
      const session = currentSession();
      if (!session) return;
      ready({ busy: "claiming", notice: null });
      claimed(await send({ type: "session_control", sessionId: session.id, control: { command: "resume" } }));
    },

    /** Reports every submission LeetCode shows first, so the outcome reflects them. */
    async finish(result: "solved" | "unsuccessful") {
      const session = currentSession();
      if (!session) return;
      ready({ busy: "finishing", notice: null });
      await pollIfDue(true);
      await reportActivity().catch(() => undefined);
      const response = await send<PracticeSessionCommandResponseDto>({
        type: "session_control",
        sessionId: session.id,
        control: { command: "finish", result, occurredAt: new Date(deps.now()).toISOString() },
      });
      const finished = tracking;
      stopTracking();
      if (finished && response.ok) awaitLateVerdicts(finished);
      if (!response.ok) return failureView(response);
      if (response.queued) return ready({ busy: null, session: { ...session, status: "completed" }, notice: { kind: "queued", action: "finish" } });
      const completed = response.response.session;
      ready({ session: completed, pendingRating: completed.rating.disposition === "pending" ? completed : null });
      // Finishing can schedule the problem (initial learning); read it back.
      await refresh();
      ready({ busy: null, notice: null });
    },

    async abandon() {
      const session = currentSession();
      if (!session) return;
      ready({ busy: "abandoning", notice: null });
      const response = await send<PracticeSessionCommandResponseDto>({
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

    /** Rates this problem's finished review, or the other review blocking a start here. */
    async rate(rating: 1 | 2 | 3 | 4) {
      const target = ratingTarget();
      if (!target) return;
      ready({ busy: "rating", notice: null });
      const response = await send<PracticeSessionRatingResponseDto>({ type: "session_rating", sessionId: target.session.id, rating });
      if (!response.ok) return ratingFailed(response, target);
      if (target.blocking) return ready({ busy: null, blockingRating: null, notice: response.queued ? { kind: "queued", action: "rating" } : { kind: "unblocked" } });
      if (response.queued) return ready({ busy: null, pendingRating: null, notice: { kind: "queued", action: "rating" } });
      ready({ busy: null, pendingRating: null, problem: response.response.problem, notice: { kind: "rated", nextDue: response.response.nextDue } });
    },

    /** Skips the rating: the review stays in history and the schedule is unchanged. */
    async skipRating() {
      const target = ratingTarget();
      if (!target) return;
      ready({ busy: "rating", notice: null });
      const response = await send<PracticeSessionCommandResponseDto>({ type: "session_rating_decision", sessionId: target.session.id, decision: "dismiss" });
      if (!response.ok) return ratingFailed(response, target);
      if (target.blocking) return ready({ busy: null, blockingRating: null, notice: response.queued ? { kind: "queued", action: "rating_decision" } : { kind: "unblocked" } });
      ready({ busy: null, pendingRating: null, notice: response.queued ? { kind: "queued", action: "rating_decision" } : null });
    },

    /** Starts an analysis of the latest finished session (the user's own key). */
    async analyze() {
      const current = view.kind === "ready" ? view.analysis : null;
      if (!current || current.busy) return;
      setAnalysis({ ...current, busy: "starting", error: null });
      const result = await send<PublicAiJobDto>({ type: "analysis_start", sessionId: current.sessionId });
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
      const result = await send({ type: "analysis_finding", mistakeId, decision, ...(category ? { category } : {}) });
      const latest = view.kind === "ready" ? view.analysis : null;
      if (latest?.sessionId !== current.sessionId) return;
      if (!result.ok) return setAnalysis({ ...latest, busy: null, error: (result as { error: string }).error });
      await loadAnalysis(current.sessionId);
    },

    /** Visibility or focus changed: close the timing interval, and when the
     *  page is active again check LeetCode right away (debounced). */
    onVisibilityChange() {
      // Back on the page after signing in to ankify (or reconnecting): read again.
      if ((view.kind === "signed_out" || view.kind === "offline") && isVisible() && deps.now() - lastRecoverAt >= FOCUS_POLL_DEBOUNCE_MS) {
        lastRecoverAt = deps.now();
        void refresh();
        return;
      }
      // An analysis still running after polling gave up is checked again.
      const analysis = view.kind === "ready" ? view.analysis : null;
      if (deps.isActive() && analysis && !analysisPoll && !analysis.busy && jobActive(analysis.state?.job ?? null)) {
        void loadAnalysis(analysis.sessionId);
      }
      const current = tracking;
      if (!current) return;
      current.meter.sample();
      if (!isVisible() || deps.now() - lastFocusPollAt < FOCUS_POLL_DEBOUNCE_MS) return;
      lastFocusPollAt = deps.now();
      current.nextPollAt = 0;
      void pollIfDue();
    },

    dispose() {
      disposed = true;
      late?.cancel();
      stopTracking();
      stopAnalysisPoll();
      listeners.clear();
    },
  };
}

export type PageSession = ReturnType<typeof createPageSession>;
