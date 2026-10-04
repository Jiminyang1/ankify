import { useCallback, useEffect, useRef, useState } from "react";
import { createAiJobClient } from "@ankify/api-client";
import type {
  AgentPageContext,
  AgentSessionDto,
  AgentSessionSnapshotDto,
  AgentStepDto,
  AgentStreamEvent,
  PublicAiJobDto,
} from "@ankify/contracts";
import type { ContentResponse, EditorSnapshot, ExtSettings } from "../shared/messages";
import { apiFetch } from "./api";
import { PopupMarkdown } from "./PopupMarkdown";

/** The problem the Problem tab resolved, when it's saved in ankify. */
export type CoachSavedProblem = { slug: string; problemId: string; title: string };

export type CoachCopy = {
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

type PageInfo = { tabId: number; slug: string; title: string | null } | null;

/** The Study Coach, beside the LeetCode problem in the active tab. Shares the
 *  web app's conversations; each turn carries the problem and, unless turned
 *  off, a snapshot of LeetCode's editor. */
export function CoachTab({
  settings,
  saved,
  copy,
}: {
  settings: ExtSettings;
  saved: CoachSavedProblem | null;
  copy: CoachCopy;
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
  const [page, setPage] = useState<PageInfo>(null);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, PublicAiJobDto>>({});
  const abortRef = useRef<AbortController | null>(null);
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

  // Resume the conversation this panel used last, else the newest one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY] as string | undefined;
        const response = await api("/api/agent/sessions", { cache: "no-store" });
        if (!response.ok) throw new Error(copy.loadFailed);
        const { sessions } = (await response.json()) as { sessions: AgentSessionDto[] };
        const id = sessions.find((session) => session.id === stored)?.id ?? sessions[0]?.id ?? null;
        if (cancelled) return;
        setSessionId(id);
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
  }, [api, copy.loadFailed, loadSnapshot]);

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
  }, [snapshot, partial, pendingMessage]);

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

  async function send(message: string) {
    const text = message.trim();
    if (!text || streaming || remoteRunActive) return;
    const controller = new AbortController();
    abortRef.current = controller;
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
        body: JSON.stringify({ sessionId, requestId: crypto.randomUUID(), message: text, context }),
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
      void chrome.storage.local.set({ [SESSION_KEY]: event.session.id });
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
    void chrome.storage.local.remove(SESSION_KEY);
  }

  async function actOnProposal(step: AgentStepDto, action: "approve" | "dismiss") {
    setBusyStep(step.id);
    setError(null);
    try {
      const response = await api(`/api/agent/steps/${encodeURIComponent(step.id)}/${action}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        step?: AgentStepDto;
        job?: PublicAiJobDto;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.step) throw new Error(body?.message ?? body?.error ?? copy.sendFailed);
      setSnapshot((current) => (current ? { ...current, steps: upsert(current.steps, body.step!) } : current));
      if (body.job) followJob(body.job);
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

  return (
    <div className="coach">
      <div className="coach-bar">
        <div className="coach-context">
          {page ? (
            <>
              <span className="coach-context-title">{copy.onProblem(savedHere?.title ?? page.title ?? page.slug)}</span>
              {!savedHere && <span className="coach-context-note">{copy.notSaved}</span>}
            </>
          ) : (
            <span className="coach-context-note">{copy.offPage}</span>
          )}
        </div>
        <button type="button" className="btn-xs" onClick={newChat} disabled={streaming || !sessionId}>
          {copy.newChat}
        </button>
      </div>

      <div className="coach-thread scroll-area" ref={scrollRef} aria-live="polite">
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
            return (
              <div key={run.id} className="coach-turn">
                {user && <div className="coach-msg coach-msg-user">{user.content}</div>}
                {steps.map((step) => (
                  <CoachStep
                    key={step.id}
                    step={step}
                    job={step.aiJobId ? jobs[step.aiJobId] : undefined}
                    busy={busyStep === step.id}
                    copy={copy}
                    onApprove={() => void actOnProposal(step, "approve")}
                    onDismiss={() => void actOnProposal(step, "dismiss")}
                    onOpen={() => openInAnkify(step)}
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
              </div>
            );
          })
        )}
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
          rows={3}
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
    </div>
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
}: {
  step: AgentStepDto;
  job: PublicAiJobDto | undefined;
  busy: boolean;
  copy: CoachCopy;
  onApprove: () => void;
  onDismiss: () => void;
  onOpen: () => void;
}) {
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
    return (
      <div className="coach-proposal">
        <p className="coach-proposal-summary">{step.summary}</p>
        {step.proposal.reason && <p className="popup-muted">{step.proposal.reason}</p>}
        {step.status === "pending" ? (
          <div className="coach-proposal-actions">
            <button type="button" className="btn-xs btn-xs-accent" disabled={busy} onClick={onApprove}>
              {busy && <span className="btn-spinner" />}
              {copy.approve}
            </button>
            <button type="button" className="btn-xs" disabled={busy} onClick={onDismiss}>
              {copy.dismiss}
            </button>
          </div>
        ) : step.status === "dismissed" ? (
          <p className="popup-muted">{copy.dismissed}</p>
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
