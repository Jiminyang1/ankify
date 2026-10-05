import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createAiJobClient } from "@ankify/api-client";
import type {
  WeaknessDto,
  PracticeSessionDto,
  AgentPageContext,
  AgentSessionDto,
  AgentSessionSnapshotDto,
  AgentStepDto,
  AgentStreamEvent,
  DocEdit,
  PublicAiJobDto,
} from "@ankify/contracts";
import type { ContentResponse, EditorSnapshot, ExtSettings } from "../shared/messages";
import { apiFetch } from "./api";
import { PopupMarkdown } from "./PopupMarkdown";
import { PracticeWidget, type PracticeCopy } from "./PracticeWidget";
import { WeakSpots, type WeakSpotsCopy } from "./WeakSpots";
import { builtinWeaknessCategoryName } from "@ankify/core";

/** The problem the Problem tab resolved, when it's saved in ankify. */
export type CoachSavedProblem = { slug: string; problemId: string; title: string; due: boolean };

export type CoachCopy = {
  practice: PracticeCopy;
  weakSpots: WeakSpotsCopy & { analyzePrompt: string; noted: (detail: string) => string };
  startPractice: string;
  rateDirectly: string;
  dueForReview: string;
  practiceFinished: (points: number, total: number) => string;
  title: string;
  showChat: string;
  hideChat: string;
  intro: string;
  placeholder: string;
  send: string;
  stop: string;
  newChat: string;
  includeCode: string;
  onProblem: (title: string) => string;
  notSaved: string;
  offPage: string;
  thinking: string;
  quick: { failing: string; hint: string; history: string };
  approve: string;
  apply: string;
  applied: string;
  dismiss: string;
  dismissed: string;
  jobRunning: string;
  jobDone: string;
  jobFailed: string;
  openReview: string;
  openProblem: string;
  noCode: string;
  loadFailed: string;
  sendFailed: string;
};

const SESSION_KEY = "ankify.coachSessionId";
/** Each problem keeps its own conversation; off a problem, the latest one. */
const sessionKeyFor = (slug: string | null) => (slug ? `ankify.coachSession:${slug}` : SESSION_KEY);

type PageInfo = { tabId: number; slug: string; title: string | null } | null;

/** The Study Coach, docked at the bottom of the side panel. Collapsed it is
 *  just a composer; sending (or "Show chat") expands it over the panel's
 *  content. Shares the web app's conversations; each turn carries the problem
 *  in the active tab and, unless turned off, a snapshot of LeetCode's editor. */
export function CoachTab({
  settings,
  saved,
  copy,
  mode,
  expanded,
  onExpandedChange,
  ratingPanel,
  onDocsChanged,
  onProblemChanged,
}: {
  settings: ExtSettings;
  saved: CoachSavedProblem | null;
  copy: CoachCopy;
  /** "full": the chat is the problem view. "dock": a composer under other
   *  content that expands over it. */
  mode: "full" | "dock";
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Rating buttons for a due problem reviewed another way (like re-solving). */
  ratingPanel: ReactNode;
  /** A doc-edit proposal was applied: the Docs view should reload. */
  onDocsChanged: () => void;
  /** The problem was rated from a practice summary. */
  onProblemChanged: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AgentSessionSnapshotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [includeCode, setIncludeCode] = useState(true);
  /** undefined until the active tab is known. */
  const [page, setPage] = useState<PageInfo | undefined>(undefined);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, PublicAiJobDto>>({});
  const abortRef = useRef<AbortController | null>(null);
  /** A session started from the button, or resumed, that no Coach step shows. */
  const [localPractice, setLocalPractice] = useState<PracticeSessionDto | null>(null);
  const [startingPractice, setStartingPractice] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [weaknesses, setWeaknesses] = useState<WeaknessDto[] | null>(null);
  const debriefed = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const jobClient = useRef(createAiJobClient((path, init) => apiFetch(settings, path, init))).current;

  const api = useCallback((path: string, init?: RequestInit) => apiFetch(settings, path, init), [settings]);

  const loadSnapshot = useCallback(
    async (id: string) => {
      const response = await api(`/api/agent/sessions/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(copy.loadFailed);
      const body = (await response.json()) as { snapshot: AgentSessionSnapshotDto };
      setSnapshot(body.snapshot);
    },
    [api, copy.loadFailed],
  );

  // On a problem, resume that problem's conversation (or start empty); off a
  // problem, resume the latest one.
  const scopeSlug = page === undefined ? undefined : (page?.slug ?? null);
  const streamingRef = useRef(false);
  streamingRef.current = streaming;
  useEffect(() => {
    if (scopeSlug === undefined || streamingRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const key = sessionKeyFor(scopeSlug);
        const stored = (await chrome.storage.local.get(key))[key] as string | undefined;
        const response = await api("/api/agent/sessions", { cache: "no-store" });
        if (!response.ok) throw new Error(copy.loadFailed);
        const { sessions } = (await response.json()) as { sessions: AgentSessionDto[] };
        const id =
          sessions.find((session) => session.id === stored)?.id ?? (scopeSlug ? null : (sessions[0]?.id ?? null));
        if (cancelled) return;
        setSessionId(id);
        setSnapshot(null);
        setJobs({});
        if (id) await loadSnapshot(id);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, copy.loadFailed, loadSnapshot, scopeSlug]);

  // Track the active tab so the context line matches what the next turn sends.
  useEffect(() => {
    const refresh = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      const slug = tab?.url?.match(/leetcode\.com\/problems\/([^/?#]+)/)?.[1] ?? null;
      setPage(tab?.id != null && slug ? { tabId: tab.id, slug, title: problemTitle(tab.title) } : null);
    };
    void refresh();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (info.url || info.title)) void refresh();
    };
    const onActivated = () => void refresh();
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // Another client (the web app) may be mid-reply in this conversation.
  const remoteRunActive = !streaming && (snapshot?.runs.some((run) => run.status === "running") ?? false);
  useEffect(() => {
    if (!remoteRunActive || !sessionId) return;
    const timer = window.setInterval(() => void loadSnapshot(sessionId).catch(() => {}), 1_500);
    return () => window.clearInterval(timer);
  }, [loadSnapshot, remoteRunActive, sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [snapshot, partial, pendingMessage, expanded]);

  // Follow jobs started from approved proposals until they finish.
  const followJob = useCallback(
    (job: PublicAiJobDto) => {
      setJobs((current) => ({ ...current, [job.id]: job }));
      void jobClient
        .wait(job)
        .then((done) => setJobs((current) => ({ ...current, [done.id]: done })))
        .catch(() => {});
    },
    [jobClient],
  );
  useEffect(() => {
    for (const step of snapshot?.steps ?? []) {
      if (step.status === "accepted" && step.aiJobId && !jobs[step.aiJobId]) {
        void jobClient.get(step.aiJobId).then(followJob).catch(() => {});
      }
    }
  }, [followJob, jobClient, jobs, snapshot?.steps]);

  const savedHere = saved && page && saved.slug === page.slug ? saved : null;
  const savedProblemId = savedHere?.problemId ?? null;

  // Resume a session in progress (or finished, awaiting its debrief).
  useEffect(() => {
    setLocalPractice(null);
    if (!savedProblemId) return;
    let cancelled = false;
    void api(`/api/problems/${savedProblemId}/practice`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { session: PracticeSessionDto | null }).session : null))
      .then((session) => {
        if (!cancelled && session) setLocalPractice(session);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, savedProblemId]);

  const loadWeaknessesRef = useRef<() => Promise<void>>(async () => {});
  // Loads can overlap (a "noted" step, then a removal); only the latest wins.
  const weaknessLoadSeq = useRef(0);
  const loadWeaknesses = useCallback(async () => {
    if (!savedProblemId) return;
    const seq = ++weaknessLoadSeq.current;
    try {
      const res = await api(`/api/problems/${savedProblemId}/weaknesses`, { cache: "no-store" });
      if (!res.ok) return;
      const { weaknesses: next } = (await res.json()) as { weaknesses: WeaknessDto[] };
      if (seq === weaknessLoadSeq.current) setWeaknesses(next);
    } catch {
      /* the card just keeps what it had */
    }
  }, [api, savedProblemId]);

  loadWeaknessesRef.current = loadWeaknesses;
  useEffect(() => {
    setWeaknesses(null);
    void loadWeaknesses();
  }, [loadWeaknesses]);

  async function removeWeakness(id: string) {
    await api(`/api/weaknesses/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    }).catch(() => null);
    void loadWeaknesses();
  }

  async function startPracticeHere() {
    if (!savedProblemId || startingPractice) return;
    setStartingPractice(true);
    setError(null);
    try {
      const res = await api(`/api/problems/${savedProblemId}/practice`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { session?: PracticeSessionDto; message?: string; error?: string } | null;
      if (!res.ok || !body?.session) {
        // Name the status so a wrong server or an unexpected reply is diagnosable.
        throw new Error(body?.message ?? body?.error ?? `${copy.practice.actionFailed} (HTTP ${res.status})`);
      }
      setLocalPractice(body.session);
      onExpandedChange(true);
      // A talk-through starts with the Coach's first question.
      if (body.session.mode === "talk" && body.session.status === "active") {
        void sendRef.current(copy.practice.startMessage, { type: "practice_start", practiceSessionId: body.session.id });
      }
    } catch (startError) {
      console.error("[ankify] start practice failed", startError);
      setError(startError instanceof Error ? startError.message : copy.practice.actionFailed);
    } finally {
      setStartingPractice(false);
    }
  }

  // Latest send, so the completion callback below can stay stable.
  const sendRef = useRef<typeof send>(null as unknown as typeof send);
  const practiceCompleted = useCallback(
    (session: PracticeSessionDto) => {
      setLocalPractice((current) => (current?.id === session.id ? session : current));
      if (debriefed.current.has(session.id)) return;
      debriefed.current.add(session.id);
      // A talk-through is summarized by the Coach in the same turn; its weak
      // spots may have been resolved or repeated.
      if (session.mode === "talk") {
        void loadWeaknessesRef.current();
        return;
      }
      const items = session.recall.length + (session.check.status === "ready" ? session.check.items.length : 0);
      const points =
        session.recall.filter((card) => card.result === "got_it").length +
        session.check.items.filter((item) => item.answer?.correct).length;
      void sendRef.current(copy.practiceFinished(points, items), {
        type: "practice_completed",
        practiceSessionId: session.id,
      });
    },
    [copy],
  );

  async function buildContext(): Promise<AgentPageContext> {
    if (!page) return { page: "extension", activePanel: "overview", problemId: null };
    let editor: EditorSnapshot | null = null;
    if (includeCode) {
      try {
        const response = (await chrome.tabs.sendMessage(page.tabId, { type: "read_editor" })) as ContentResponse;
        editor = response.type === "editor" ? response.editor : null;
      } catch {
        editor = null;
      }
      if (!editor) setNotice(copy.noCode);
    }
    const title = savedHere?.title ?? page.title;
    return {
      page: "leetcode",
      activePanel: "overview",
      problemId: savedHere?.problemId ?? null,
      leetcode: {
        slug: page.slug,
        ...(title ? { title } : {}),
        ...(editor ? { editor } : {}),
      },
    };
  }

  async function send(
    message: string,
    trigger?: { type: "practice_completed" | "practice_start" | "analyze_attempts"; practiceSessionId?: string },
  ) {
    const text = message.trim();
    if (!text || streaming || remoteRunActive) return;
    const controller = new AbortController();
    abortRef.current = controller;
    onExpandedChange(true);
    setStreaming(true);
    setPartial("");
    setPendingMessage(text);
    setError(null);
    setNotice(null);
    setDraft("");
    try {
      const context = await buildContext();
      const response = await api("/api/agent/turns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, requestId: crypto.randomUUID(), message: text, context, ...(trigger ? { trigger } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
        setDraft(text);
        throw new Error(body?.message ?? body?.error ?? copy.sendFailed);
      }
      await readStream(response.body, (event) => handleEvent(event));
    } catch (sendError) {
      if (!(sendError instanceof DOMException && sendError.name === "AbortError")) {
        setError(sendError instanceof Error ? sendError.message : copy.sendFailed);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setPartial("");
      setPendingMessage(null);
    }
  }

  function handleEvent(event: AgentStreamEvent) {
    if (event.type === "run_started") {
      setSessionId(event.session.id);
      void chrome.storage.local.set({ [SESSION_KEY]: event.session.id, [sessionKeyFor(page?.slug ?? null)]: event.session.id });
      setPendingMessage(null);
      setSnapshot((current) =>
        current && current.session.id === event.session.id
          ? {
              ...current,
              session: event.session,
              messages: upsert(current.messages, event.message),
              runs: upsert(current.runs, event.run),
            }
          : { session: event.session, messages: [event.message], runs: [event.run], steps: [] },
      );
    } else if (event.type === "text_delta") {
      setPartial((current) => current + event.delta);
    } else if (event.type === "step") {
      setSnapshot((current) => (current ? { ...current, steps: upsert(current.steps, event.step) } : current));
      if (event.step.kind === "weakness") void loadWeaknesses();
      // The Coach started a talk-through: pin it above the chat.
      if (event.step.kind === "practice" && event.step.practiceSessionId) {
        void api(`/api/practice/${event.step.practiceSessionId}`, { cache: "no-store" })
          .then(async (res) => (res.ok ? ((await res.json()) as { session: PracticeSessionDto }).session : null))
          .then((session) => {
            if (session) setLocalPractice(session);
          })
          .catch(() => {});
      }
    } else if (event.type === "done") {
      setPartial("");
      setSnapshot((current) =>
        current
          ? {
              ...current,
              session: event.session,
              messages: upsert(current.messages, event.message),
              runs: upsert(current.runs, event.run),
            }
          : current,
      );
    } else if (event.type === "error") {
      setPartial("");
      setError(event.message);
      setSnapshot((current) => (current ? { ...current, runs: upsert(current.runs, event.run) } : current));
    }
  }

  function newChat() {
    if (streaming) return;
    setSessionId(null);
    setSnapshot(null);
    setJobs({});
    setError(null);
    setNotice(null);
    void chrome.storage.local.remove(sessionKeyFor(page?.slug ?? null));
  }

  async function actOnProposal(step: AgentStepDto, action: "approve" | "dismiss") {
    setBusyStep(step.id);
    setError(null);
    try {
      const response = await api(`/api/agent/steps/${encodeURIComponent(step.id)}/${action}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        step?: AgentStepDto;
        job?: PublicAiJobDto;
        docs?: unknown;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.step) throw new Error(body?.message ?? body?.error ?? copy.sendFailed);
      setSnapshot((current) => (current ? { ...current, steps: upsert(current.steps, body.step!) } : current));
      if (body.job) followJob(body.job);
      if (body.docs) onDocsChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : copy.sendFailed);
    } finally {
      setBusyStep(null);
    }
  }

  function openInAnkify(step: AgentStepDto) {
    if (!step.navigation) return;
    const base = settings.apiBaseUrl.replace(/\/+$/, "");
    const { destination, problemId } = step.navigation;
    const path =
      destination === "review"
        ? `/review?problemId=${encodeURIComponent(problemId)}`
        : `/problems/${encodeURIComponent(problemId)}`;
    void chrome.tabs.create({ url: `${base}${path}` });
  }

  const runs = snapshot?.runs ?? [];
  const busy = streaming || remoteRunActive;
  const quickPrompts = page
    ? [copy.quick.failing, copy.quick.hint, ...(savedHere ? [copy.quick.history] : [])]
    : [];

  const composer = (
    <form
      className="coach-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send(draft);
      }}
    >
      <textarea
        className="textarea-card coach-input scroll-area"
        value={draft}
        rows={expanded ? 3 : 2}
        maxLength={12_000}
        placeholder={copy.placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send(draft);
          }
        }}
      />
      <div className="coach-composer-row">
        {page ? (
          <label className="coach-toggle">
            <input type="checkbox" checked={includeCode} onChange={(event) => setIncludeCode(event.target.checked)} />
            {copy.includeCode}
          </label>
        ) : (
          <span />
        )}
        {streaming ? (
          <button type="button" className="btn btn-secondary btn-inline" onClick={() => abortRef.current?.abort()}>
            {copy.stop}
          </button>
        ) : (
          <button type="submit" className="btn btn-primary btn-inline" disabled={!draft.trim() || busy}>
            {copy.send}
          </button>
        )}
      </div>
    </form>
  );

  sendRef.current = send;
  const practiceShownInThread = new Set(
    (snapshot?.steps ?? []).flatMap((step) => (step.practiceSessionId ? [step.practiceSessionId] : [])),
  );
  // Whether a session is running comes from the server (resume on load, or
  // the session the Coach or the button started), not from old chat steps.
  const practiceActive = localPractice?.status === "active";
  const practiceChip =
    savedHere && !practiceActive && !streaming ? (
      <div className="coach-chip-wrap">
        <div className="coach-chip">
          {savedHere.due && <span className="coach-chip-label">{copy.dueForReview}</span>}
          <div className="coach-chip-actions">
            {savedHere.due && ratingPanel && (
              <button type="button" className="btn-xs" onClick={() => setShowRating((open) => !open)}>
                {copy.rateDirectly}
              </button>
            )}
            <button
              type="button"
              className={savedHere.due ? "btn-xs btn-xs-accent" : "btn-xs"}
              disabled={startingPractice || busy}
              onClick={() => void startPracticeHere()}
            >
              {startingPractice && <span className="btn-spinner" />}
              {copy.startPractice}
            </button>
          </div>
        </div>
        {showRating && savedHere.due && ratingPanel}
      </div>
    ) : null;
  const categoryName = (key: string) =>
    weaknesses?.find((weakness) => weakness.category === key)?.categoryName ??
    builtinWeaknessCategoryName(key, settings.language) ??
    key;
  const pinnedTalk = localPractice?.mode === "talk" ? localPractice : null;
  const renderPractice = (practiceSessionId: string, initial?: PracticeSessionDto) => (
    <PracticeWidget
      key={practiceSessionId}
      settings={settings}
      sessionId={practiceSessionId}
      initial={initial}
      copy={copy.practice}
      onCompleted={practiceCompleted}
      onRated={onProblemChanged}
      categoryName={categoryName}
    />
  );

  if (mode === "dock" && !expanded) {
    return (
      <section className="coach coach-docked" aria-label={copy.title}>
        <div className="coach-dock-head">
          <span className="coach-dock-title">{copy.title}</span>
          {(runs.length > 0 || error || localPractice) && (
            <button type="button" className="btn-xs" onClick={() => onExpandedChange(true)}>
              {copy.showChat}
            </button>
          )}
        </div>
        {practiceChip}
        {error && <p className="coach-run-error">{error}</p>}
        {composer}
      </section>
    );
  }

  return (
    <section className={`coach coach-expanded${mode === "full" ? " coach-full" : ""}`} aria-label={copy.title}>
      <div className="coach-bar">
        <div className="coach-context">
          {mode === "full" ? (
            <span className="coach-dock-title">{copy.title}</span>
          ) : page ? (
            <>
              <span className="coach-context-title">{copy.onProblem(savedHere?.title ?? page.title ?? page.slug)}</span>
              {!savedHere && <span className="coach-context-note">{copy.notSaved}</span>}
            </>
          ) : (
            <span className="coach-context-note">{copy.offPage}</span>
          )}
        </div>
        <div className="coach-bar-actions">
          <button type="button" className="btn-xs" onClick={newChat} disabled={streaming || !sessionId}>
            {copy.newChat}
          </button>
          {mode === "dock" && (
            <button type="button" className="btn-xs" onClick={() => onExpandedChange(false)}>
              {copy.hideChat}
            </button>
          )}
        </div>
      </div>

      <div className="coach-thread scroll-area" ref={scrollRef} aria-live="polite">
        {mode === "full" && savedHere && weaknesses && (
          <WeakSpots
            weaknesses={weaknesses}
            language={settings.language}
            copy={copy.weakSpots}
            busy={busy || streaming}
            onAnalyze={() => void send(copy.weakSpots.analyzePrompt, { type: "analyze_attempts" })}
            onRemove={(id) => void removeWeakness(id)}
          />
        )}
        {mode === "full" && pinnedTalk && renderPractice(pinnedTalk.id, pinnedTalk)}
        {loading ? (
          <p className="popup-muted coach-thinking">
            <span className="btn-spinner" /> {copy.thinking}
          </p>
        ) : runs.length === 0 && !pendingMessage ? (
          <div className="coach-empty">
            <p className="popup-muted">{copy.intro}</p>
            {quickPrompts.length > 0 && (
              <div className="coach-quick">
                {quickPrompts.map((prompt) => (
                  <button key={prompt} type="button" className="btn-xs" disabled={busy} onClick={() => void send(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          runs.map((run) => {
            const user = snapshot?.messages.find((m) => m.runId === run.id && m.role === "user");
            const assistant = snapshot?.messages.find((m) => m.runId === run.id && m.role === "assistant");
            const steps = (snapshot?.steps ?? []).filter((step) => step.runId === run.id);
            const live = streaming && run.status === "running";
            // A session started from the button sits right before its debrief.
            const practiceBefore =
              localPractice && !pinnedTalk && run.context.practice?.practiceSessionId === localPractice.id
                ? renderPractice(localPractice.id, localPractice)
                : null;
            return (
              <div key={run.id} className="coach-turn">
                {practiceBefore}
                {user && <div className="coach-msg coach-msg-user">{user.content}</div>}
                {steps.filter((step) => step.kind !== "practice").map((step) => (
                  <CoachStep
                    key={step.id}
                    step={step}
                    job={step.aiJobId ? jobs[step.aiJobId] : undefined}
                    busy={busyStep === step.id}
                    copy={copy}
                    onApprove={() => void actOnProposal(step, "approve")}
                    onDismiss={() => void actOnProposal(step, "dismiss")}
                    onOpen={() => openInAnkify(step)}
                    onRemoveWeakness={(id) => void removeWeakness(id)}
                  />
                ))}
                {assistant ? (
                  <div className="coach-msg coach-msg-assistant">
                    <PopupMarkdown>{assistant.content}</PopupMarkdown>
                  </div>
                ) : live && partial ? (
                  <div className="coach-msg coach-msg-assistant">
                    <PopupMarkdown>{partial}</PopupMarkdown>
                  </div>
                ) : run.status === "running" ? (
                  <p className="popup-muted coach-thinking">
                    <span className="btn-spinner" /> {copy.thinking}
                  </p>
                ) : run.status === "failed" && run.errorMessage ? (
                  <p className="coach-run-error">{run.errorMessage}</p>
                ) : null}
                {steps
                  .filter(
                    (step) =>
                      step.kind === "practice" && step.practiceSessionId && step.practiceSessionId !== pinnedTalk?.id,
                  )
                  .map((step) => renderPractice(step.practiceSessionId!))}
              </div>
            );
          })
        )}
        {localPractice &&
          !pinnedTalk &&
          !practiceShownInThread.has(localPractice.id) &&
          !runs.some((run) => run.context.practice?.practiceSessionId === localPractice.id) &&
          renderPractice(localPractice.id, localPractice)}
        {pendingMessage && (
          <div className="coach-turn">
            <div className="coach-msg coach-msg-user">{pendingMessage}</div>
            <p className="popup-muted coach-thinking">
              <span className="btn-spinner" /> {copy.thinking}
            </p>
          </div>
        )}
      </div>

      {practiceChip}
      {error && <div className="err-banner">{error}</div>}
      {notice && !error && <p className="coach-notice">{notice}</p>}

      {composer}
    </section>
  );
}

function CoachStep({
  step,
  job,
  busy,
  copy,
  onApprove,
  onDismiss,
  onOpen,
  onRemoveWeakness,
}: {
  step: AgentStepDto;
  job: PublicAiJobDto | undefined;
  busy: boolean;
  copy: CoachCopy;
  onApprove: () => void;
  onDismiss: () => void;
  onOpen: () => void;
  onRemoveWeakness: (id: string) => void;
}) {
  if (step.kind === "weakness") {
    return (
      <div className="coach-step coach-step-weakness">
        <span>{copy.weakSpots.noted(step.summary)}</span>
        {step.weaknessId && (
          <button type="button" className="btn-xs" onClick={() => onRemoveWeakness(step.weaknessId!)}>
            {copy.weakSpots.remove}
          </button>
        )}
      </div>
    );
  }
  if (step.kind === "navigation" && step.navigation) {
    return (
      <div className="coach-step">
        <button type="button" className="btn-xs btn-xs-accent" onClick={onOpen}>
          {step.navigation.destination === "review" ? copy.openReview : copy.openProblem}
        </button>
      </div>
    );
  }
  if (step.kind === "proposal" && step.proposal) {
    const docEdit = step.proposal.action === "doc_edit" ? step.proposal.edit : null;
    const preview = docEdit ? docEditPreview(docEdit) : null;
    return (
      <div className="coach-proposal">
        <p className="coach-proposal-summary">{step.summary}</p>
        {preview && (
          <div className="coach-proposal-preview">
            <PopupMarkdown>{preview}</PopupMarkdown>
          </div>
        )}
        {step.proposal.reason && <p className="popup-muted">{step.proposal.reason}</p>}
        {step.status === "pending" ? (
          <div className="coach-proposal-actions">
            <button type="button" className="btn-xs btn-xs-accent" disabled={busy} onClick={onApprove}>
              {busy && <span className="btn-spinner" />}
              {docEdit ? copy.apply : copy.approve}
            </button>
            <button type="button" className="btn-xs" disabled={busy} onClick={onDismiss}>
              {copy.dismiss}
            </button>
          </div>
        ) : step.status === "dismissed" ? (
          <p className="popup-muted">{copy.dismissed}</p>
        ) : step.status === "accepted" && docEdit ? (
          <p className="popup-muted">{copy.applied}</p>
        ) : step.status === "accepted" ? (
          <p className="popup-muted coach-thinking">
            {!job || job.status === "queued" || job.status === "running" ? (
              <>
                <span className="btn-spinner" /> {copy.jobRunning}
              </>
            ) : job.status === "succeeded" ? (
              copy.jobDone
            ) : (
              copy.jobFailed
            )}
          </p>
        ) : null}
      </div>
    );
  }
  return <p className="coach-step coach-step-read">{step.summary}</p>;
}

/** What a doc-edit proposal would write, shown before the user applies it. */
function docEditPreview(edit: DocEdit): string | null {
  switch (edit.op) {
    case "append_section":
    case "replace_section":
      return edit.markdown;
    case "add_card":
      return `**${edit.prompt}**\n\n${edit.answer}`;
    case "update_card":
      return [edit.prompt ? `**${edit.prompt}**` : null, edit.answer ?? null].filter(Boolean).join("\n\n") || null;
    case "remove_card":
      return null;
  }
}

/** "Two Sum - LeetCode" -> "Two Sum". */
function problemTitle(tabTitle: string | undefined): string | null {
  const title = tabTitle?.replace(/\s*-\s*LeetCode\s*$/i, "").trim();
  return title ? title.slice(0, 512) : null;
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => (current.id === item.id ? item : current))
    : [...items, item];
}

async function readStream(stream: ReadableStream<Uint8Array>, onEvent: (event: AgentStreamEvent) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line) onEvent(JSON.parse(line) as AgentStreamEvent);
    }
  }
  buffer += decoder.decode();
  if (buffer) onEvent(JSON.parse(buffer) as AgentStreamEvent);
}
