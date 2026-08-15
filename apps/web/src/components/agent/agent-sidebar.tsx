"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import type {
  AgentRunDto,
  AgentSessionDto,
  AgentSessionSnapshotDto,
  AgentStepDto,
  AgentStreamEvent,
  PublicAiJobDto,
} from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { notifyAgentJobUpdated } from "@/lib/agent-events";
import { cn } from "@/lib/utils";
import type { AgentClientContext } from "./agent-shell";

type AgentSidebarProps = {
  open: boolean;
  onClose: () => void;
  pageContext: AgentClientContext;
  embedded?: boolean;
};

const ACTIVE_SESSION_KEY = "ankify:agent-session-id";
const boundaryDismissedKey = (sessionId: string) =>
  `ankify:agent-session-boundary:${sessionId}`;

export function AgentSidebar({
  open,
  onClose,
  pageContext,
  embedded = false,
}: AgentSidebarProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const [sessions, setSessions] = useState<AgentSessionDto[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [boundaryDismissedAt, setBoundaryDismissedAt] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<AgentSessionSnapshotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [partialResponse, setPartialResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, PublicAiJobDto>>({});
  const turnAbortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const notifiedJobsRef = useRef(new Set<string>());
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);

  const loadSnapshot = useCallback(async (
    sessionId: string,
    signal?: AbortSignal,
    showLoading = true,
  ) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(t.agent.loadFailed);
      const body = (await response.json()) as {
        ok: true;
        snapshot: AgentSessionSnapshotDto;
      };
      setSnapshot(body.snapshot);
      const boundaryKey = boundaryDismissedKey(body.snapshot.session.id);
      if (body.snapshot.session.suggestNewSession) {
        const stored = sessionStorage.getItem(boundaryKey);
        setBoundaryDismissedAt(stored ? Number(stored) : null);
      } else {
        sessionStorage.removeItem(boundaryKey);
        setBoundaryDismissedAt(null);
      }
      setSessions((current) => sortSessions(mergeById(current, body.snapshot.session)));
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : t.agent.loadFailed);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t.agent.loadFailed]);

  useEffect(() => {
    return () => turnAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!sessionMenuOpen) return;
    const ownerDocument = sessionMenuRef.current!.ownerDocument;
    const closeMenu = (event: PointerEvent) => {
      if (!sessionMenuRef.current?.contains(event.target as Node)) setSessionMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSessionMenuOpen(false);
    };
    ownerDocument.addEventListener("pointerdown", closeMenu);
    ownerDocument.addEventListener("keydown", closeOnEscape);
    return () => {
      ownerDocument.removeEventListener("pointerdown", closeMenu);
      ownerDocument.removeEventListener("keydown", closeOnEscape);
    };
  }, [sessionMenuOpen]);

  useEffect(() => {
    if (!open || sessionsLoaded) return;
    const controller = new AbortController();
    queueMicrotask(() => void (async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/agent/sessions", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(t.agent.loadFailed);
        const nextSessions = ((await response.json()) as {
          ok: true;
          sessions: AgentSessionDto[];
        }).sessions;
        let sessionId = sessionStorage.getItem(ACTIVE_SESSION_KEY);
        if (!sessionId || !nextSessions.some((session) => session.id === sessionId)) {
          sessionId = nextSessions[0]?.id ?? null;
        }
        setSessions(nextSessions);
        if (sessionId) {
          await loadSnapshot(sessionId, controller.signal);
          setActiveSessionId(sessionId);
          sessionStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
        } else {
          setSnapshot(null);
          setLoading(false);
          sessionStorage.removeItem(ACTIVE_SESSION_KEY);
        }
        setSessionsLoaded(true);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : t.agent.loadFailed);
        setLoading(false);
        setSessionsLoaded(true);
      }
    })());
    return () => controller.abort();
  }, [loadSnapshot, open, sessionsLoaded, t.agent.loadFailed]);

  const persistedRunActive = snapshot?.runs.some((run) => run.status === "running") ?? false;
  useEffect(() => {
    if (!open || !activeSessionId || streaming || !persistedRunActive) return;
    const timer = window.setInterval(
      () => void loadSnapshot(activeSessionId, undefined, false),
      1_500,
    );
    return () => window.clearInterval(timer);
  }, [activeSessionId, loadSnapshot, open, persistedRunActive, streaming]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [partialResponse, snapshot?.messages.length, snapshot?.steps.length]);

  const acceptedJobIds = useMemo(
    () =>
      [...new Set(
        (snapshot?.steps ?? [])
          .filter((step) => step.status === "accepted" && step.aiJobId)
          .map((step) => step.aiJobId!),
      )],
    [snapshot?.steps],
  );
  const pollingJobKey = acceptedJobIds
    .filter((jobId) => {
      const status = jobs[jobId]?.status;
      return status === undefined || status === "queued" || status === "running";
    })
    .join("|");
  useEffect(() => {
    const pollingJobIds = pollingJobKey ? pollingJobKey.split("|") : [];
    if (!open || pollingJobIds.length === 0) return;
    let cancelled = false;
    const loadJobs = async () => {
      const results = await Promise.all(
        pollingJobIds.map(async (jobId) => {
          const response = await fetch(`/api/ai-jobs/${encodeURIComponent(jobId)}`, {
            cache: "no-store",
          });
          if (!response.ok) throw new Error("agent_job_load_failed");
          return ((await response.json()) as { job: PublicAiJobDto }).job;
        }),
      );
      if (cancelled) return;
      setJobs((current) => ({
        ...current,
        ...Object.fromEntries(results.map((job) => [job.id, job])),
      }));
    };
    void loadJobs();
    const timer = window.setInterval(() => void loadJobs(), 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, pollingJobKey]);

  useEffect(() => {
    for (const job of Object.values(jobs)) {
      if (job.status !== "succeeded" || notifiedJobsRef.current.has(job.id)) continue;
      notifiedJobsRef.current.add(job.id);
      notifyAgentJobUpdated(job);
      router.refresh();
    }
  }, [jobs, router]);

  const handleStreamEvent = useCallback((event: AgentStreamEvent) => {
    if (event.type === "run_started") {
      const storedBoundary = sessionStorage.getItem(boundaryDismissedKey(event.session.id));
      setBoundaryDismissedAt(storedBoundary ? Number(storedBoundary) : null);
      setActiveRunId(event.run.id);
      setActiveSessionId(event.session.id);
      sessionStorage.setItem(ACTIVE_SESSION_KEY, event.session.id);
      setSessions((current) => sortSessions(mergeById(current, event.session)));
      setSnapshot((current) => ({
        session: event.session,
        messages: mergeById(current?.messages ?? [], event.message),
        runs: mergeById(current?.runs ?? [], event.run),
        steps: current?.steps ?? [],
      }));
      return;
    }
    if (event.type === "text_delta") {
      setPartialResponse((current) => current + event.delta);
      return;
    }
    if (event.type === "step") {
      setSnapshot((current) =>
        current ? { ...current, steps: mergeById(current.steps, event.step) } : current,
      );
      if (event.step.kind === "navigation" && event.step.navigation) {
        const problemId = encodeURIComponent(event.step.navigation.problemId);
        const href = event.step.navigation.destination === "review"
          ? `/review?problemId=${problemId}`
          : `/problems/${problemId}`;
        router.push(href);
      }
      return;
    }
    if (event.type === "done") {
      if (!event.session.suggestNewSession) {
        sessionStorage.removeItem(boundaryDismissedKey(event.session.id));
        setBoundaryDismissedAt(null);
      }
      setSessions((current) => sortSessions(mergeById(current, event.session)));
      setSnapshot((current) =>
        current
          ? {
              ...current,
              session: event.session,
              messages: mergeById(current.messages, event.message),
              runs: replaceById(current.runs, event.run),
            }
          : current,
      );
      setPartialResponse("");
      return;
    }
    setSnapshot((current) =>
      current ? { ...current, runs: replaceById(current.runs, event.run) } : current,
    );
    setPartialResponse("");
  }, [router]);

  const sendMessage = useCallback(async (message: string) => {
    if (streaming || persistedRunActive || !message.trim()) return;
    const controller = new AbortController();
    turnAbortRef.current = controller;
    setStreaming(true);
    setPartialResponse("");
    setError(null);

    try {
      const response = await fetch("/api/agent/turns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          requestId: crypto.randomUUID(),
          message: message.trim(),
          context: {
            page: pageContext.page,
            activePanel: pageContext.activePanel,
            problemId: pageContext.problemId,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string; error: string };
        throw new Error(body.message ?? body.error);
      }
      await readAgentStream(response.body!, handleStreamEvent);
    } catch (sendError) {
      if (sendError instanceof DOMException && sendError.name === "AbortError") return;
      setError(sendError instanceof Error ? sendError.message : t.agent.sendFailed);
    } finally {
      if (turnAbortRef.current === controller) turnAbortRef.current = null;
      setStreaming(false);
      setActiveRunId(null);
    }
  }, [activeSessionId, handleStreamEvent, pageContext, persistedRunActive, streaming, t.agent.sendFailed]);

  const createSession = useCallback(() => {
    if (streaming || persistedRunActive || !activeSessionId) return;
    setActiveSessionId(null);
    setBoundaryDismissedAt(null);
    setSnapshot(null);
    setJobs({});
    setPartialResponse("");
    setError(null);
    setLoading(false);
    sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    setSessionMenuOpen(false);
  }, [activeSessionId, persistedRunActive, streaming]);

  const continueSession = useCallback(() => {
    if (!activeSessionId || !snapshot) return;
    const runCount = snapshot.session.contextRunCount;
    sessionStorage.setItem(boundaryDismissedKey(activeSessionId), String(runCount));
    setBoundaryDismissedAt(runCount);
  }, [activeSessionId, snapshot]);

  const switchSession = useCallback((sessionId: string) => {
    if (streaming || persistedRunActive || sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setSnapshot(null);
    setJobs({});
    setError(null);
    sessionStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    setSessionMenuOpen(false);
    void loadSnapshot(sessionId);
  }, [activeSessionId, loadSnapshot, persistedRunActive, streaming]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft;
    setDraft("");
    void sendMessage(message);
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const approveProposal = async (step: AgentStepDto) => {
    setActionBusy(step.id);
    setError(null);
    try {
      const response = await fetch(`/api/agent/steps/${encodeURIComponent(step.id)}/approve`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        step?: AgentStepDto;
        job?: PublicAiJobDto;
        message?: string;
        error?: string;
      };
      if (!response.ok || !body.step || !body.job) {
        throw new Error(body.message ?? body.error ?? t.agent.sendFailed);
      }
      setSnapshot((current) =>
        current ? { ...current, steps: replaceById(current.steps, body.step!) } : current,
      );
      setJobs((current) => ({ ...current, [body.job!.id]: body.job! }));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t.agent.sendFailed);
    } finally {
      setActionBusy(null);
    }
  };

  const dismissProposal = async (step: AgentStepDto) => {
    setActionBusy(step.id);
    setError(null);
    try {
      const response = await fetch(`/api/agent/steps/${encodeURIComponent(step.id)}/dismiss`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        step?: AgentStepDto;
        message?: string;
        error?: string;
      };
      if (!response.ok || !body.step) {
        throw new Error(body.message ?? body.error ?? t.agent.sendFailed);
      }
      setSnapshot((current) =>
        current ? { ...current, steps: replaceById(current.steps, body.step!) } : current,
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t.agent.sendFailed);
    } finally {
      setActionBusy(null);
    }
  };

  const runs = snapshot?.runs ?? [];
  const activeSessionTitle = snapshot?.session.title ?? t.agent.untitledSession;

  return (
    <aside
      aria-label={t.agent.title}
      aria-hidden={!open}
      className={cn(
        embedded
          ? "h-full min-w-0 flex-col overflow-hidden bg-surface"
          : "mx-6 mb-8 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card transition-opacity duration-200 motion-reduce:transition-none md:sticky md:top-[93px] md:mx-0 md:mb-0 md:mr-6 md:h-[calc(100dvh-125px)] md:self-start",
        open
          ? embedded
            ? "flex"
            : "flex h-[calc(100dvh-126px)] opacity-100 sm:h-[calc(100dvh-93px)] md:h-[calc(100dvh-125px)]"
          : embedded
            ? "hidden"
            : "hidden md:flex md:pointer-events-none md:invisible md:opacity-0",
      )}
    >
        <header className="relative shrink-0 border-b border-border bg-surface px-3 py-2">
          <div ref={sessionMenuRef} className="flex items-center gap-1.5">
            {!embedded && (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              </span>
            )}
            <button
              type="button"
              onClick={() => setSessionMenuOpen((current) => !current)}
              disabled={streaming || persistedRunActive}
              aria-label={t.agent.session}
              aria-expanded={sessionMenuOpen}
              aria-haspopup="menu"
              title={activeSessionTitle}
              className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg px-1.5 text-left transition hover:bg-subtle disabled:opacity-60"
            >
              <span className="min-w-0 truncate text-sm font-semibold text-fg">
                {embedded ? activeSessionTitle : t.agent.title}
              </span>
              {(pageContext.problemTitle ?? pageContext.contextLabel) && (
                <span className="min-w-0 truncate text-xs text-muted">
                  · {pageContext.problemTitle ?? pageContext.contextLabel}
                </span>
              )}
              <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            </button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label={t.agent.close}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>

            {sessionMenuOpen && (
              <div
                role="menu"
                aria-label={t.agent.session}
                className="absolute left-3 right-3 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-card-hover"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={createSession}
                  disabled={streaming || persistedRunActive || !activeSessionId}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-fg transition hover:bg-subtle disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5 text-accent" aria-hidden />
                  {t.agent.newSession}
                </button>
                {sessions.length > 0 && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                      {t.agent.recentSessions}
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {sessions.map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={session.id === activeSessionId}
                          onClick={() => switchSession(session.id)}
                          disabled={streaming || persistedRunActive}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-fg transition hover:bg-subtle disabled:opacity-50"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {session.title ?? t.agent.untitledSession}
                          </span>
                          {session.id === activeSessionId && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              {t.agent.loadingHistory}
            </div>
          ) : runs.length === 0 ? (
            <div className="flex min-h-full flex-col justify-center py-8">
              <CenteredMessage
                title={t.agent.emptyTitle}
                body={pageContext.problemId ? t.agent.emptyBody : t.agent.globalEmptyBody}
              />
              <div className="mt-5 flex flex-col gap-2">
                {(pageContext.problemId
                  ? [
                      t.agent.suggestions.submission,
                      t.agent.suggestions.review,
                      t.agent.suggestions.card,
                    ]
                  : [
                      t.agent.globalSuggestions.review,
                      t.agent.globalSuggestions.urgent,
                      t.agent.globalSuggestions.trend,
                    ]
                ).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void sendMessage(suggestion)}
                    disabled={streaming || persistedRunActive}
                    className="rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-sm text-fg transition hover:border-accent/35 hover:bg-subtle disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {runs.map((run) => (
                <AgentTurn
                  key={run.id}
                  run={run}
                  snapshot={snapshot!}
                  partialResponse={activeRunId === run.id ? partialResponse : ""}
                  jobs={jobs}
                  actionBusy={actionBusy}
                  onApprove={approveProposal}
                  onDismiss={dismissProposal}
                />
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-xs text-danger">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {snapshot?.session.suggestNewSession && boundaryDismissedAt === null && (
          <div className="mx-3 mb-3 rounded-xl border border-accent/25 bg-accent/6 p-3">
            <p className="text-xs font-semibold text-fg">{t.agent.sessionBoundaryTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {t.agent.sessionBoundaryBody}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                size="xs"
                variant="primary"
                onClick={createSession}
                disabled={streaming || persistedRunActive}
              >
                {t.agent.newSession}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={continueSession}
                disabled={streaming || persistedRunActive}
              >
                {t.agent.continueSession}
              </Button>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="shrink-0 border-t border-border bg-surface p-3">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-bg p-2 focus-within:border-accent/45">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={2}
              maxLength={12_000}
              disabled={streaming || persistedRunActive}
              placeholder={pageContext.problemId ? t.agent.placeholder : t.agent.globalPlaceholder}
              className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-relaxed text-fg outline-none placeholder:text-muted disabled:opacity-60"
            />
            <Button
              type="submit"
              variant="primary"
              size="icon"
              disabled={streaming || persistedRunActive || !draft.trim()}
              aria-label={t.agent.send}
            >
              {streaming ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </div>
        </form>
    </aside>
  );
}

function AgentTurn({
  run,
  snapshot,
  partialResponse,
  jobs,
  actionBusy,
  onApprove,
  onDismiss,
}: {
  run: AgentRunDto;
  snapshot: AgentSessionSnapshotDto;
  partialResponse: string;
  jobs: Record<string, PublicAiJobDto>;
  actionBusy: string | null;
  onApprove: (step: AgentStepDto) => void;
  onDismiss: (step: AgentStepDto) => void;
}) {
  const { t } = useLanguage();
  const userMessage = snapshot.messages.find(
    (message) => message.runId === run.id && message.role === "user",
  );
  const assistantMessage = snapshot.messages.find(
    (message) => message.runId === run.id && message.role === "assistant",
  );
  const steps = snapshot.steps
    .filter((step) => step.runId === run.id)
    .sort((a, b) => a.sequence - b.sequence);

  return (
    <section className="space-y-3">
      {userMessage && (
        <div className="ml-8 rounded-xl rounded-br-sm bg-accent px-3.5 py-2.5 text-sm leading-relaxed text-accent-contrast">
          {userMessage.content}
        </div>
      )}

      {steps.length > 0 && (
        <div className="space-y-2">
          {steps.map((step) => (
            <AgentStep
              key={step.id}
              step={step}
              job={step.aiJobId ? jobs[step.aiJobId] : undefined}
              busy={actionBusy === step.id}
              onApprove={() => onApprove(step)}
              onDismiss={() => onDismiss(step)}
            />
          ))}
        </div>
      )}

      {(assistantMessage || partialResponse) && (
        <div className="mr-3 rounded-xl rounded-bl-sm border border-border bg-surface px-3.5 py-3">
          <Markdown className="break-words [&_pre]:max-w-full">
            {assistantMessage?.content ?? partialResponse}
          </Markdown>
          {!assistantMessage && run.status === "running" && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
              <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
              {t.agent.responding}
            </div>
          )}
        </div>
      )}

      {run.status === "running" && !partialResponse && !assistantMessage && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {t.agent.responding}
        </div>
      )}
      {run.status === "failed" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-xs text-danger">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {run.errorMessage ?? t.agent.failed}
        </div>
      )}
    </section>
  );
}

function AgentStep({
  step,
  job,
  busy,
  onApprove,
  onDismiss,
}: {
  step: AgentStepDto;
  job?: PublicAiJobDto;
  busy: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLanguage();
  const toolLabel = t.agent.tools[step.toolName as keyof typeof t.agent.tools] ?? step.summary;
  const jobActive = job?.status === "running" || job?.status === "queued";
  const jobFailed =
    job?.status === "failed" || job?.status === "cancelled" || job?.status === "superseded";
  if (step.kind === "read") {
    return (
      <div className="flex items-center gap-2 px-1 text-[11px] text-muted">
        <Check className="h-3 w-3 text-success" aria-hidden />
        <span>{toolLabel}</span>
      </div>
    );
  }

  if (step.kind === "navigation" && step.navigation) {
    const problemId = encodeURIComponent(step.navigation.problemId);
    const href = step.navigation.destination === "review"
      ? `/review?problemId=${problemId}`
      : `/problems/${problemId}`;
    return (
      <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-2">
          <Check className="h-3 w-3 text-success" aria-hidden />
          {toolLabel}
        </span>
        <Link href={href} className="font-medium text-accent hover:underline">
          {step.navigation.destination === "review" ? t.agent.openReview : t.agent.viewProblem}
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-accent/25 bg-accent/6 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-fg">
        <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
        {t.agent.proposalTitle} · {toolLabel}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{step.summary}</p>
      {step.status === "pending" && (
        <div className="mt-3 flex gap-2">
          <Button size="xs" variant="primary" onClick={onApprove} disabled={busy}>
            {busy ? t.agent.confirming : t.agent.confirm}
          </Button>
          <Button size="xs" variant="ghost" onClick={onDismiss} disabled={busy}>
            {t.agent.notNow}
          </Button>
        </div>
      )}
      {step.status === "accepted" && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            {jobActive ? (
              <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
            ) : jobFailed ? (
              <CircleAlert className="h-3 w-3 text-danger" aria-hidden />
            ) : (
              <Check className="h-3 w-3 text-success" aria-hidden />
            )}
            {job ? t.agent[job.status] : t.agent.accepted}
          </span>
          {step.proposal && (
            <Link
              href={`/problems/${step.proposal.problemId}`}
              className={buttonClasses({ variant: "ghost", size: "xs" })}
            >
              {t.agent.viewProblem}
            </Link>
          )}
        </div>
      )}
      {step.status === "dismissed" && (
        <p className="mt-3 text-xs text-muted">{t.agent.dismissed}</p>
      )}
    </div>
  );
}

function CenteredMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-subtle text-muted">
        <Sparkles className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-fg">{title}</h3>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">{body}</p>
    </div>
  );
}

async function readAgentStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: AgentStreamEvent) => void,
) {
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

function mergeById<T extends { id: string }>(items: T[], item: T) {
  return items.some((current) => current.id === item.id)
    ? replaceById(items, item)
    : [...items, item];
}

function replaceById<T extends { id: string }>(items: T[], item: T) {
  return items.map((current) => (current.id === item.id ? item : current));
}

function sortSessions(sessions: AgentSessionDto[]) {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
