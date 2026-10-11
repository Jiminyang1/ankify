import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createAiJobClient } from "@ankify/api-client";
import type {
  WeaknessDto,
  PracticeSessionDto,
  AgentPageContext,
  AgentSessionDto,
  AgentSessionSnapshotDto,
  AgentStepDto,
  AgentStreamEvent,
  AgentModelChoice,
  CoachModelsDto,
  DocEdit,
  PublicAiJobDto,
} from "@ankify/contracts";
import type { ContentResponse, EditorReadFailure, EditorSnapshot, ExtSettings } from "../shared/messages";
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
  history: string;
  modelMenu: string;
  modelHeading: string;
  thinkingHeading: string;
  /** Marks the model chosen in Settings. */
  fromSettings: string;
  reasoningLevel: (level: string) => string;
  noHistory: string;
  untitled: string;
  includeCode: string;
  /** Short label on the code toggle; includeCode is its tooltip. */
  codeLabel: string;
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
  noCode: (reason: EditorReadFailure) => string;
  loadFailed: string;
  sendFailed: string;
};

const SESSION_KEY = "ankify.coachSessionId";
/** The model and thinking level picked in the panel; Settings' when unset. */
const MODEL_KEY = "ankify.coachModel";
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
  /** Past conversations, loaded when the history menu opens. */
  const [history, setHistory] = useState<AgentSessionDto[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const [models, setModels] = useState<CoachModelsDto | null>(null);
  const [modelChoice, setModelChoice] = useState<AgentModelChoice | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const modelRef = useRef<HTMLDivElement | null>(null);
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
      let reason: EditorReadFailure = "no_receiver";
      try {
        const response = (await chrome.tabs.sendMessage(page.tabId, { type: "read_editor" })) as ContentResponse | undefined;
        if (response?.type === "editor") {
          editor = response.editor;
          reason = response.reason ?? "no_code_model";
        }
      } catch (readError) {
        console.warn("[ankify] read_editor: no content script in tab", page.tabId, readError);
      }
      if (!editor) {
        console.warn("[ankify] read_editor failed:", reason);
        setNotice(copy.noCode(reason));
      }
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
    // A pick only counts on the user's own key (the server checks too).
    const activeChoice = models?.source === "user" ? modelChoice : null;
    try {
      const context = await buildContext();
      const response = await api("/api/agent/turns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          requestId: crypto.randomUUID(),
          message: text,
          context,
          ...(trigger ? { trigger } : {}),
          ...(activeChoice ? { model: activeChoice } : {}),
        }),
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
    } else if (event.type === "practice") {
      // The reply was judged: progress shows before the Coach answers.
      setLocalPractice((current) => (current?.id === event.session.id ? event.session : current));
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
    inputRef.current?.focus();
  }

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    try {
      const response = await api("/api/agent/sessions", { cache: "no-store" });
      if (!response.ok) throw new Error(copy.loadFailed);
      setHistory(((await response.json()) as { sessions: AgentSessionDto[] }).sessions);
    } catch (loadError) {
      setHistoryOpen(false);
      setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
    }
  }

  async function openSession(id: string) {
    setHistoryOpen(false);
    if (streaming || id === sessionId) return;
    setSessionId(id);
    setSnapshot(null);
    setJobs({});
    setError(null);
    setNotice(null);
    setLoading(true);
    // This problem (or, off a problem, the panel) resumes it next time.
    void chrome.storage.local.set({ [sessionKeyFor(page?.slug ?? null)]: id });
    try {
      await loadSnapshot(id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  // Menus close on a click outside them or Escape.
  useDismiss(historyOpen, historyRef, () => setHistoryOpen(false));
  useDismiss(modelOpen, modelRef, () => setModelOpen(false));

  // What the model picker offers. The pick is kept across problems and
  // dropped when Settings move to another provider or it's no longer offered.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api("/api/agent/models", { cache: "no-store" });
        if (!res.ok) return;
        const dto = (await res.json()) as CoachModelsDto;
        const stored = (await chrome.storage.local.get(MODEL_KEY))[MODEL_KEY] as
          | (AgentModelChoice & { provider?: string })
          | undefined;
        if (cancelled) return;
        setModels(dto);
        if (stored && stored.provider === dto.provider && dto.models.some((model) => model.id === stored.id)) {
          setModelChoice({ id: stored.id, ...(stored.reasoningLevel ? { reasoningLevel: stored.reasoningLevel } : {}) });
        }
      } catch {
        /* no picker; turns use the Settings model */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  function pickModel(choice: AgentModelChoice) {
    setModelChoice(choice);
    if (models) void chrome.storage.local.set({ [MODEL_KEY]: { ...choice, provider: models.provider } });
  }

  // The composer grows with its text, up to a few lines, then scrolls.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
  }, [draft, expanded]);

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
  // Only the user's own key can switch models; the starter key's is fixed.
  const pickable = models && models.source === "user" && models.models.length > 0 ? models : null;
  const currentModelId = modelChoice?.id ?? pickable?.defaultModel ?? null;
  const currentLevel =
    modelChoice?.reasoningLevel ??
    (currentModelId === pickable?.defaultModel ? pickable?.defaultReasoningLevel : "default") ??
    "default";
  const currentLevels = pickable?.models.find((model) => model.id === currentModelId)?.reasoningLevels ?? [];
  const quickPrompts = page
    ? [copy.quick.failing, copy.quick.hint, ...(savedHere ? [copy.quick.history] : [])]
    : [];

  sendRef.current = send;
  const practiceShownInThread = new Set(
    (snapshot?.steps ?? []).flatMap((step) => (step.practiceSessionId ? [step.practiceSessionId] : [])),
  );
  // Whether a session is running comes from the server (resume on load, or
  // the session the Coach or the button started), not from old chat steps.
  const practiceActive = localPractice?.status === "active";
  const canPractice = savedHere != null && !practiceActive && !streaming;
  const canRate = canPractice && savedHere.due && ratingPanel != null;

  const categoryName = (key: string) =>
    weaknesses?.find((weakness) => weakness.category === key)?.categoryName ??
    builtinWeaknessCategoryName(key, settings.language) ??
    key;
  const pinnedTalk = localPractice?.mode === "talk" ? localPractice : null;
  const renderPractice = (practiceSessionId: string, initial?: PracticeSessionDto, variant: "card" | "tray" = "card") => (
    <PracticeWidget
      key={`${variant}-${practiceSessionId}`}
      variant={variant}
      onClose={() => setLocalPractice((current) => (current?.id === practiceSessionId ? null : current))}
      settings={settings}
      sessionId={practiceSessionId}
      initial={initial}
      copy={copy.practice}
      onCompleted={practiceCompleted}
      onRated={onProblemChanged}
      onAbandoned={(session) => setLocalPractice((current) => (current?.id === session.id ? null : current))}
      categoryName={categoryName}
    />
  );
  const modelPicker =
    pickable && currentModelId ? (
      <div className="coach-model-wrap" ref={modelRef}>
        <button
          type="button"
          className="coach-icon coach-model"
          aria-label={copy.modelMenu}
          title={`${currentModelId} · ${copy.reasoningLevel(currentLevel)}`}
          aria-expanded={modelOpen}
          disabled={streaming}
          onClick={() => setModelOpen((open) => !open)}
        >
          <TuneIcon />
        </button>
        {modelOpen && (
          <div className="coach-history-menu coach-model-menu scroll-area" role="menu">
            <p className="coach-menu-heading">{copy.modelHeading}</p>
            {pickable.models.map((model) => (
              <button
                key={model.id}
                type="button"
                role="menuitemradio"
                aria-checked={model.id === currentModelId}
                className="coach-history-item"
                onClick={() => {
                  // A new model starts at its own default thinking level.
                  if (model.id !== currentModelId) pickModel({ id: model.id });
                }}
              >
                <span className="coach-history-title">{model.id}</span>
                {model.id === pickable.defaultModel && <span className="coach-history-date">{copy.fromSettings}</span>}
              </button>
            ))}
            {currentLevels.length > 0 && (
              <>
                <p className="coach-menu-heading">{copy.thinkingHeading}</p>
                <div className="coach-levels">
                  {["default", ...currentLevels].map((level) => (
                    <button
                      key={level}
                      type="button"
                      className="coach-tool"
                      aria-pressed={level === currentLevel}
                      onClick={() =>
                        pickModel({ id: currentModelId, ...(level === "default" ? {} : { reasoningLevel: level }) })
                      }
                    >
                      {copy.reasoningLevel(level)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    ) : null;

  const composer = (
    <form
      className="coach-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send(draft);
      }}
    >
      {showRating && canRate && <div className="coach-rating">{ratingPanel}</div>}
      {/* A talk-through rides on top of the composer: one line, open on click. */}
      {pinnedTalk && renderPractice(pinnedTalk.id, pinnedTalk, "tray")}
      <div className="coach-composer-box">
        <textarea
          ref={inputRef}
          className="coach-input scroll-area"
          value={draft}
          rows={1}
          maxLength={12_000}
          placeholder={copy.placeholder}
          aria-label={copy.placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        <div className="coach-composer-row">
          <div className="coach-tools">
            {page && (
              <button
                type="button"
                className="coach-tool"
                aria-pressed={includeCode}
                title={copy.includeCode}
                onClick={() => setIncludeCode((value) => !value)}
              >
                <CodeIcon />
                {copy.codeLabel}
              </button>
            )}
            {canPractice && (
              <button
                type="button"
                className={`coach-tool${savedHere.due ? " coach-tool-accent" : ""}`}
                title={savedHere.due ? copy.dueForReview : undefined}
                disabled={startingPractice || busy}
                onClick={() => void startPracticeHere()}
              >
                {startingPractice ? <span className="btn-spinner" /> : <PlayIcon />}
                {copy.startPractice}
              </button>
            )}
            {canRate && (
              <button
                type="button"
                className="coach-tool"
                aria-expanded={showRating}
                onClick={() => setShowRating((open) => !open)}
              >
                <StarIcon />
                {copy.rateDirectly}
              </button>
            )}
          </div>
          <div className="coach-send-group">
            {modelPicker}
            {streaming ? (
              <button
                type="button"
                className="coach-send"
                aria-label={copy.stop}
                title={copy.stop}
                onClick={() => abortRef.current?.abort()}
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="submit"
                className="coach-send"
                aria-label={copy.send}
                title={copy.send}
                disabled={!draft.trim() || busy}
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );

  const headerActions = (
    <div className="coach-bar-actions">
      <div className="coach-history" ref={historyRef}>
        <button
          type="button"
          className="coach-icon"
          aria-label={copy.history}
          title={copy.history}
          aria-expanded={historyOpen}
          disabled={streaming}
          onClick={() => void toggleHistory()}
        >
          <HistoryIcon />
        </button>
        {historyOpen && (
          <div className="coach-history-menu scroll-area" role="menu">
            {history === null ? (
              <p className="popup-muted coach-thinking">
                <span className="btn-spinner" />
              </p>
            ) : history.length === 0 ? (
              <p className="popup-muted coach-history-empty">{copy.noHistory}</p>
            ) : (
              history.slice(0, 30).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  role="menuitem"
                  className="coach-history-item"
                  aria-current={session.id === sessionId}
                  onClick={() => void openSession(session.id)}
                >
                  <span className="coach-history-title">{session.title?.trim() || copy.untitled}</span>
                  <span className="coach-history-date">{formatSessionDate(session.updatedAt, settings.language)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        className="coach-icon"
        aria-label={copy.newChat}
        title={copy.newChat}
        onClick={newChat}
        disabled={streaming || !sessionId}
      >
        <NewChatIcon />
      </button>
      {mode === "dock" && (
        <button
          type="button"
          className="coach-icon"
          aria-label={copy.hideChat}
          title={copy.hideChat}
          onClick={() => onExpandedChange(false)}
        >
          <ChevronDownIcon />
        </button>
      )}
    </div>
  );


  if (mode === "dock" && !expanded) {
    return (
      <section className="coach coach-docked" aria-label={copy.title}>
        {(runs.length > 0 || error || localPractice) && (
          <div className="coach-dock-head">
            <span className="coach-dock-title">{copy.title}</span>
            <button
              type="button"
              className="coach-icon"
              aria-label={copy.showChat}
              title={copy.showChat}
              onClick={() => onExpandedChange(true)}
            >
              <ChevronDownIcon up />
            </button>
          </div>
        )}
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
            <span className="coach-context-title">{snapshot?.session.title?.trim() || copy.title}</span>
          ) : page ? (
            <>
              <span className="coach-context-title">{copy.onProblem(savedHere?.title ?? page.title ?? page.slug)}</span>
              {!savedHere && <span className="coach-context-note">{copy.notSaved}</span>}
            </>
          ) : (
            <span className="coach-context-note">{copy.offPage}</span>
          )}
        </div>
        {headerActions}
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
                  <button key={prompt} type="button" className="coach-suggestion" disabled={busy} onClick={() => void send(prompt)}>
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

/** "14:32" today, "Oct 3" this year, otherwise "2025-10-03". */
function formatSessionDate(iso: string, language: "en" | "zh"): string {
  const date = new Date(iso);
  const now = new Date();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
  }
  return date.toISOString().slice(0, 10);
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.5 2.2v7.6L9.8 6 3.5 2.2Z" fill="currentColor" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5L8 2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.3 2.6v2.3h2.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 5.2V8l2 1.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13 8.5V12a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12V5a1.5 1.5 0 0 1 1.5-1.5H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m11.6 2.4 2 2L8.2 9.8l-2.6.6.6-2.6 5.4-5.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon({ up = false }: { up?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={up ? { transform: "rotate(180deg)" } : undefined}>
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Calls `close` on a pointer down outside `ref` or on Escape while `open`. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref]);
}

/** Sliders: the model and thinking menu next to Send. */
function TuneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="11.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
