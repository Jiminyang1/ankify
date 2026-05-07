import { useCallback, useEffect, useRef, useState } from "react";
import { formatQuizMarkdown } from "@ankify/core";
import type { CapturedProblem, ContentResponse, ExtSettings } from "../shared/messages";
import { clearCardDraft, getCardDraft, getSettings, setCardDraft, setSettings } from "../shared/storage";
import { PopupMarkdown } from "./PopupMarkdown";

type ApiCard = {
  id: string;
  aiStatus: "candidate" | "failed" | "ready";
  errorMessage: string | null;
  question: string;
  answer: string;
};
type ApiProblem = {
  id: string;
  leetcodeSlug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  fsrsState: "new" | "learning" | "review" | "relearning";
  fsrsDue: string | null;
  fsrsReps: number;
  fsrsLapses: number;
  fsrsStability: number | null;
  notes: string | null;
};
type FsrsRating = 1 | 2 | 3 | 4;
type Previews = Record<FsrsRating, { due: string }>;
type ThemePreference = "system" | "light" | "dark";
type QuizItem = {
  id: string;
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  source: "statement" | "submission" | "notes" | "card";
  scope: "approach" | "invariant" | "edge_case" | "complexity" | "implementation" | "mistake_review";
};
type QuizAnswer = {
  itemId: string;
  selectedIndex: number;
  correct: boolean;
  answeredAt: string;
};
type QuizSession = {
  id: string;
  problemId: string;
  status: "active" | "completed" | "archived";
  itemsJson: QuizItem[];
  answersJson: QuizAnswer[];
  score: number | null;
  createdAt: string;
  updatedAt: string | null;
  completedAt: string | null;
};

type State =
  | { kind: "detecting" }
  | { kind: "off-page" }
  | { kind: "loading"; slug: string }
  | { kind: "not-saved"; slug: string }
  | { kind: "captured"; problem: ApiProblem; cards: ApiCard[]; candidates: ApiCard[]; previews: Previews }
  | { kind: "error"; msg: string };

type NavTab = "today" | "problem" | "settings";

type QueueStats = {
  dailyReviewLimit: number;
  doneToday: number;
  remaining: number;
  totalDue: number;
  dueCount: number;
};
type QueueProblem = {
  id: string;
  leetcodeSlug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  url: string;
  fsrsState: "new" | "learning" | "review" | "relearning";
  fsrsDue: string | null;
  fsrsStability: number | null;
  fsrsReps: number;
  fsrsLapses: number;
  cardCount: number;
};
type QueueResponse = { queue: QueueStats; problems: QueueProblem[] };

const RATING_BUTTONS: { rating: FsrsRating; label: string; hint: string }[] = [
  { rating: 1, label: "Again", hint: "Could not recall it" },
  { rating: 2, label: "Hard", hint: "Partial recall, shaky" },
  { rating: 3, label: "Good", hint: "Main idea is clear" },
  { rating: 4, label: "Easy", hint: "Can explain method and pitfalls" },
];

const QUIZ_SCOPE_LABELS: Record<QuizItem["scope"], string> = {
  approach: "Approach",
  invariant: "Invariant",
  edge_case: "Edge cases",
  complexity: "Complexity",
  implementation: "Implementation",
  mistake_review: "Mistakes",
};

const QUIZ_SOURCE_LABELS: Record<QuizItem["source"], string> = {
  statement: "Statement",
  submission: "Submission",
  notes: "Notes",
  card: "Card",
};

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const PENDING_OPERATION_TTL_MS = 90_000;
const PENDING_OPERATION_EVENT = "ankify:pending-operation";

type PendingOperation = {
  id: string;
  kind: string;
  startedAt: number;
};

/* ── helpers ── */

function jsonHeaders(settings: ExtSettings): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiToken) h["x-ankify-token"] = settings.apiToken;
  return h;
}

function authHeaders(settings: ExtSettings): HeadersInit {
  return settings.apiToken ? { "x-ankify-token": settings.apiToken } : {};
}

function pendingQuizKey(problemId: string) {
  return `ankify.pending.quiz.${problemId}`;
}

function pendingAiCardKey(problemId: string) {
  return `ankify.pending.aiCard.${problemId}`;
}

function pendingCandidateAiKey(problemId: string, cardId: string) {
  return `ankify.pending.aiCandidate.${problemId}.${cardId}`;
}

function readPendingOperation(key: string): PendingOperation | null {
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PendingOperation;
    if (!value?.id || !value.kind || !value.startedAt) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    if (Date.now() - value.startedAt > PENDING_OPERATION_TTL_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

function writePendingOperation(key: string, kind: string): PendingOperation {
  const operation: PendingOperation = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind,
    startedAt: Date.now(),
  };
  window.sessionStorage.setItem(key, JSON.stringify(operation));
  window.dispatchEvent(new CustomEvent(PENDING_OPERATION_EVENT, { detail: { key } }));
  return operation;
}

function clearPendingOperation(key: string) {
  window.sessionStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent(PENDING_OPERATION_EVENT, { detail: { key } }));
}

function isSessionNewerThanPending(session: QuizSession | null, pending: PendingOperation | null) {
  if (!session || !pending) return false;
  return new Date(session.createdAt).getTime() >= pending.startedAt - 1000;
}

function PopupBrandMark() {
  return (
    <span className="popup-brand-mark" aria-hidden>
      <svg viewBox="0 0 64 64">
        <rect x="9" y="27" width="12" height="27" rx="4.5" className="brand-bar brand-bar-left" />
        <rect x="27" y="20" width="12" height="34" rx="4.5" className="brand-bar brand-bar-mid" />
        <rect x="45" y="10" width="16" height="50" rx="6" className="brand-bar brand-bar-right" />
        <circle cx="53" cy="23" r="3" className="brand-dot" />
      </svg>
    </span>
  );
}

function PopupBrandBanner() {
  return (
    <div className="popup-brand" aria-label="ankify spaced repetition">
      <PopupBrandMark />
      <span className="popup-brand-copy">
        <span className="popup-brand-title">ankify<span>.</span></span>
        <span className="popup-brand-tag">Spaced · Repetition</span>
      </span>
    </div>
  );
}

function applyThemePreference(preference: ThemePreference) {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", preference);
  }
}

function parseSlugFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/leetcode\.com\/problems\/([^/?#]+)/);
  return m?.[1] ?? null;
}

function isDue(fsrsDue: string | null): boolean {
  if (!fsrsDue) return true;
  return new Date(fsrsDue).getTime() <= Date.now();
}

/** Compact interval: "10m", "1d", "3w", "2mo" */
function formatInterval(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "now";
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (ms < hr) return `${Math.max(1, Math.round(ms / min))}m`;
  if (ms < day) return `${Math.max(1, Math.round(ms / hr))}h`;
  if (ms < 30 * day) return `${Math.max(1, Math.round(ms / day))}d`;
  if (ms < 365 * day) return `${Math.round(ms / (30 * day))}mo`;
  return `${Math.round(ms / (365 * day))}y`;
}

async function fetchProblemBySlug(
  settings: ExtSettings,
  slug: string,
): Promise<{ problem: ApiProblem; cards: ApiCard[]; candidates: ApiCard[]; previews: Previews } | "not_captured"> {
  const res = await fetch(`${settings.apiBaseUrl}/api/problems/by-slug/${encodeURIComponent(slug)}`, {
    headers: authHeaders(settings),
  });
  if (res.status === 404) return "not_captured";
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as {
    problem: ApiProblem;
    cards: ApiCard[];
    candidates: ApiCard[];
    previews: Previews;
  };
}

/* ── Collapse (used only for ready cards) ── */

function Collapse({ header, defaultOpen, children }: { header: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="collapse">
      <button type="button" className="collapse-head" onClick={() => setOpen((v) => !v)}>
        <span className="collapse-chevron">{open ? "▾" : "▸"}</span>
        <span className="collapse-label">{header}</span>
      </button>
      <div className={`collapse-body scroll-area${open ? " collapse-body-open" : ""}`}>
        <div className="collapse-inner">{children}</div>
      </div>
    </div>
  );
}

/* ── Popup ── */

export function Popup() {
  const [state, setState] = useState<State>({ kind: "detecting" });
  const [settings, setLocalSettings] = useState<ExtSettings | null>(null);
  const [tab, setTab] = useState<NavTab>("today");
  const [theme, setTheme] = useState<ThemePreference>("system");

  useEffect(() => {
    chrome.storage.local.get("ankify.theme").then((r) => {
      const saved = r["ankify.theme"] as string | undefined;
      if (saved === "system" || saved === "dark" || saved === "light") {
        setTheme(saved);
        applyThemePreference(saved);
      }
    });
  }, []);

  function setThemePreference(next: ThemePreference) {
    setTheme(next);
    applyThemePreference(next);
    chrome.storage.local.set({ "ankify.theme": next });
  }

  useEffect(() => {
    getSettings().then(setLocalSettings);
  }, []);

  const detect = useCallback(async () => {
    if (!settings) return;
    setState({ kind: "detecting" });
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const slug = parseSlugFromUrl(activeTab?.url);
      if (!slug) {
        setState({ kind: "off-page" });
        return;
      }
      setState({ kind: "loading", slug });
      const data = await fetchProblemBySlug(settings, slug);
      if (data === "not_captured") {
        setState({ kind: "not-saved", slug });
      } else {
        setState({ kind: "captured", ...data });
      }
    } catch (e) {
      setState({ kind: "error", msg: e instanceof Error ? e.message : "Unknown error" });
    }
  }, [settings]);

  useEffect(() => {
    if (settings) void detect();
  }, [settings, detect]);

  /* Side Panel persists across tab changes — re-detect when active tab changes or url updates. */
  useEffect(() => {
    if (!settings) return;
    const onActivated = () => void detect();
    const onUpdated = (_tabId: number, info: chrome.tabs.TabChangeInfo, t: chrome.tabs.Tab) => {
      if (!t.active) return;
      if (info.url || info.status === "complete") void detect();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [settings, detect]);

  const captured = state.kind === "captured" ? state : null;

  return (
    <div className="popup-shell">
      {/* Top bar */}
      <div className="popup-topbar">
        <PopupBrandBanner />
        {(tab === "today" || tab === "problem") && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (tab === "today") window.dispatchEvent(new CustomEvent("ankify:refresh-today"));
              else void detect();
            }}
            title="Refresh"
          >
            Refresh
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="popup-nav">
        {(["today", "problem", "settings"] as NavTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className="popup-nav-tab"
            data-active={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "today" ? "Today" : t === "problem" ? "Problem" : "Settings"}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="popup-main">
        {tab === "today" && settings && (
          <div className="tab-pane" key="today">
            <TodayTab
              settings={settings}
              onJumpToProblem={() => setTab("problem")}
            />
          </div>
        )}

        {tab === "problem" && settings && (
          <div className="tab-pane" key="problem">
            <ProblemTab
              state={state}
              settings={settings}
              captured={captured}
              onRefresh={detect}
              onError={(msg) => setState({ kind: "error", msg })}
            />
          </div>
        )}

        {tab === "settings" && settings && (
          <div className="tab-pane" key="settings">
            <SettingsTab
              settings={settings}
              theme={theme}
              onThemeChange={setThemePreference}
              onSave={(next) => {
                void setSettings(next);
                setLocalSettings((prev) => (prev ? { ...prev, ...next } : prev));
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

/* ── TodayTab ── */

function TodayTab({
  settings,
  onJumpToProblem,
}: {
  settings: ExtSettings;
  onJumpToProblem: () => void;
}) {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/review/queue?limit=20`, {
        headers: authHeaders(settings),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as QueueResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Refresh on focus + every 30s + on manual top-bar refresh */
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const interval = setInterval(() => void load(), 30_000);
    const onManual = () => void load();
    window.addEventListener("ankify:refresh-today", onManual);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ankify:refresh-today", onManual);
      clearInterval(interval);
    };
  }, [load]);

  async function jumpToProblem(p: QueueProblem) {
    const url = p.url || `https://leetcode.com/problems/${p.leetcodeSlug}/`;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id != null) {
        await chrome.tabs.update(activeTab.id, { url });
      } else {
        await chrome.tabs.create({ url });
      }
      onJumpToProblem();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open tab");
    }
  }

  if (loading && !data) return <p className="popup-muted">Loading today’s queue…</p>;

  if (error) {
    return (
      <div className="stack">
        <div className="err-banner">{error}</div>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { queue, problems } = data;
  const limit = queue.dailyReviewLimit;
  const progressPct = limit > 0 ? Math.min(100, Math.round((queue.doneToday / limit) * 100)) : 0;

  return (
    <div className="stack">
      <div className="panel today-stats">
        <div className="today-stats-row">
          <div>
            <div className="today-stats-num">
              {queue.doneToday}
              <span className="today-stats-num-soft"> / {limit || "∞"}</span>
            </div>
            <div className="today-stats-label">reviews today</div>
          </div>
          <div className="today-stats-side">
            <div>
              <span className="today-stats-pillval">{queue.dueCount}</span>
              <span className="today-stats-pilllabel"> due</span>
            </div>
            <div>
              <span className="today-stats-pillval">{queue.remaining}</span>
              <span className="today-stats-pilllabel"> left today</span>
            </div>
          </div>
        </div>
        {limit > 0 && (
          <div className="today-progress">
            <div className="today-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>

      {problems.length === 0 ? (
        <div className="panel panel-quiet">
          <p className="popup-muted" style={{ margin: 0, textAlign: "center" }}>
            {queue.remaining === 0
              ? "🎉 Daily limit reached. Take a break."
              : queue.totalDue === 0
                ? "All caught up — nothing due right now."
                : "No problems in queue."}
          </p>
        </div>
      ) : (
        <div className="problem-list">
          <div className="section-label">Due now</div>
          {problems.map((p) => (
            <button
              key={p.id}
              type="button"
              className="problem-list-item"
              onClick={() => void jumpToProblem(p)}
            >
              <div className="problem-list-item-row">
                <span className="problem-list-item-title">{p.title}</span>
                <span className={`pill pill-${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>
              </div>
              <div className="problem-list-item-meta">
                <span className="pill pill-state">{p.fsrsState}</span>
                <span>{p.cardCount} card{p.cardCount === 1 ? "" : "s"}</span>
                {p.fsrsStability != null && <span>stability {p.fsrsStability.toFixed(1)}d</span>}
                {p.fsrsLapses > 0 && <span>{p.fsrsLapses} lapse{p.fsrsLapses === 1 ? "" : "s"}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      <a
        href={`${settings.apiBaseUrl}/review`}
        target="_blank"
        rel="noreferrer"
        className="hero-link"
      >
        Open full review on web ↗
      </a>
    </div>
  );
}

/* ── ProblemTab ── */

function ProblemTab({
  state,
  settings,
  captured,
  onRefresh,
  onError,
}: {
  state: State;
  settings: ExtSettings;
  captured: {
    problem: ApiProblem;
    cards: ApiCard[];
    candidates: ApiCard[];
    previews: Previews;
  } | null;
  onRefresh: () => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"review" | "manage">("review");
  const lastProblemIdRef = useRef<string | null>(null);

  // Auto-select mode when problem changes: due → review, otherwise → manage
  useEffect(() => {
    if (!captured) return;
    const newId = captured.problem.id;
    if (lastProblemIdRef.current !== newId) {
      setMode(isDue(captured.problem.fsrsDue) ? "review" : "manage");
      lastProblemIdRef.current = newId;
    }
  }, [captured]);

  if (state.kind === "detecting") return <p className="popup-muted">Connecting…</p>;
  if (state.kind === "loading") return <p className="popup-muted">Syncing <span className="popup-code">{state.slug}</span>…</p>;

  if (state.kind === "off-page") {
    return (
      <div className="panel panel-quiet">
        <p className="popup-muted" style={{ margin: 0 }}>
          Open a <strong style={{ color: "var(--fg)" }}>LeetCode problem</strong> tab (URL contains{" "}
          <span className="popup-code">/problems/</span>) to start reviewing.
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="stack">
        <div className="err-banner">{state.msg}</div>
        <button type="button" onClick={onRefresh} className="btn btn-primary">
          Retry
        </button>
      </div>
    );
  }

  if (state.kind === "not-saved") {
    return (
      <CaptureView
        slug={state.slug}
        settings={settings}
        onCaptured={onRefresh}
        onError={onError}
      />
    );
  }

  if (!captured) return null;

  const { problem, cards, candidates, previews } = captured;
  const due = isDue(problem.fsrsDue);

  return mode === "review" ? (
    <ReviewView
      problem={problem}
      cards={cards}
      previews={previews}
      settings={settings}
      due={due}
      mode={mode}
      onModeChange={setMode}
      onRefresh={onRefresh}
      onRated={onRefresh}
    />
  ) : (
    <ManageView
      problem={problem}
      cards={cards}
      candidates={candidates}
      settings={settings}
      due={due}
      mode={mode}
      onModeChange={setMode}
      onRefresh={onRefresh}
    />
  );
}

/* ── ProblemCard (Module 1: context + mode toggle) ── */

function ProblemCard({
  problem,
  settings,
  due,
  mode,
  onModeChange,
}: {
  problem: ApiProblem;
  settings: ExtSettings;
  due: boolean;
  mode: "review" | "manage";
  onModeChange: (m: "review" | "manage") => void;
}) {
  return (
    <div className="problem-card">
      <div className="problem-card-top">
        <div className="problem-card-info">
          <h2 className="problem-card-title">{problem.title}</h2>
          <div className="problem-card-tags">
            <span className={`pill pill-${problem.difficulty.toLowerCase()}`}>{problem.difficulty}</span>
            {due ? (
              <span className="pill pill-due">due</span>
            ) : (
              <span className="problem-card-next">next: {formatInterval(problem.fsrsDue)}</span>
            )}
          </div>
        </div>
        <a
          href={`${settings.apiBaseUrl}/problems/${problem.id}`}
          target="_blank"
          rel="noreferrer"
          className="problem-header-web"
          title="Open in web"
          aria-label="Open in web"
        >
          ↗
        </a>
      </div>
      <div className="problem-card-mode">
        <button
          type="button"
          className={`problem-card-mode-btn${mode === "review" ? " active" : ""}`}
          onClick={() => onModeChange("review")}
        >
          Review
        </button>
        <button
          type="button"
          className={`problem-card-mode-btn${mode === "manage" ? " active" : ""}`}
          onClick={() => onModeChange("manage")}
        >
          Manage
        </button>
      </div>
    </div>
  );
}

/* ── ReviewView ── */

function ReviewView({
  problem,
  cards,
  previews,
  settings,
  due,
  mode,
  onModeChange,
  onRefresh,
  onRated,
}: {
  problem: ApiProblem;
  cards: ApiCard[];
  previews: Previews;
  settings: ExtSettings;
  due: boolean;
  mode: "review" | "manage";
  onModeChange: (m: "review" | "manage") => void;
  onRefresh: () => void;
  onRated: () => void;
}) {
  const [view, setView] = useState<"quiz" | "card" | "notes">("quiz");

  return (
    <div className="review-workspace">
      {/* Module 1 — problem context */}
      <ProblemCard problem={problem} settings={settings} due={due} mode={mode} onModeChange={onModeChange} />

      {/* Module 2 — content */}
      <div className="content-card">
        <div className="content-card-tabs">
          {(["quiz", "card", "notes"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="content-card-tab"
              data-active={view === v}
              onClick={() => setView(v)}
            >
              {v === "quiz" ? "Quiz" : v === "card" ? "Cards" : "Notes"}
            </button>
          ))}
        </div>

        <div className="review-stage-body">
          {view === "quiz" && (
            <div className="review-stage-pane tab-pane" key="quiz">
              <QuizPanel
                problem={problem}
                settings={settings}
                onRefresh={onRefresh}
              />
            </div>
          )}

          {view === "card" && (
            <div className="review-stage-pane tab-pane" key="card">
              {cards.length === 0 ? (
                <div className="review-empty">
                  <p className="popup-muted" style={{ margin: 0, marginBottom: 12, textAlign: "center" }}>
                    No cards yet.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onModeChange("manage")}
                  >
                    Go to Manage
                  </button>
                </div>
              ) : (
                <CardFlipper cards={cards} />
              )}
            </div>
          )}

          {view === "notes" && (
            <div className="review-stage-pane tab-pane" key="notes">
              <NotesPanel problem={problem} settings={settings} />
            </div>
          )}
        </div>
      </div>

      {/* Module 3 — rating */}
      {due && (
        <div className="rating-card">
          <QuickRate
            problemId={problem.id}
            previews={previews}
            settings={settings}
            onRated={onRated}
          />
        </div>
      )}
    </div>
  );
}

/* ── QuizPanel ── */

function QuizPanel({ problem, settings, onRefresh }: { problem: ApiProblem; settings: ExtSettings; onRefresh: () => void }) {
  const [session, setSession] = useState<QuizSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pendingQuiz, setPendingQuiz] = useState<PendingOperation | null>(null);
  const [submittingItem, setSubmittingItem] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ item: QuizItem; answer: QuizAnswer } | null>(null);
  const [savedItemIds, setSavedItemIds] = useState<Set<string>>(new Set());
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [savingMissed, setSavingMissed] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPendingQuiz = useCallback(() => {
    const pending = readPendingOperation(pendingQuizKey(problem.id));
    setPendingQuiz(pending);
    setGenerating(Boolean(pending));
    return pending;
  }, [problem.id]);

  const loadSession = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    setFeedback(null);
    setSavedItemIds(new Set());
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/quiz`, {
        headers: authHeaders(settings),
      });
      const json = (await res.json().catch(() => null)) as { session?: QuizSession | null; error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const nextSession = json?.session ?? null;
      const pending = readPendingOperation(pendingQuizKey(problem.id));
      if (isSessionNewerThanPending(nextSession, pending) && nextSession?.status === "active") {
        clearPendingOperation(pendingQuizKey(problem.id));
        setPendingQuiz(null);
        setGenerating(false);
      } else {
        setPendingQuiz(pending);
        setGenerating(Boolean(pending));
      }
      const pendingFeedback = getStoredQuizFeedback(problem.id, nextSession);
      setSession(nextSession);
      setFeedback(pendingFeedback);
      setCurrentIndex(pendingFeedback ? getQuizItemIndex(nextSession, pendingFeedback.item.id) : getFirstUnansweredQuizIndex(nextSession));
      setSavingMissed(false);
      setShowResults(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load quiz");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [problem.id, settings]);

  useEffect(() => {
    refreshPendingQuiz();
    void loadSession();
  }, [loadSession, refreshPendingQuiz]);

  useEffect(() => {
    const key = pendingQuizKey(problem.id);
    const handlePendingChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key && detail.key !== key) return;
      refreshPendingQuiz();
    };
    window.addEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
    return () => window.removeEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
  }, [problem.id, refreshPendingQuiz]);

  useEffect(() => {
    if (!pendingQuiz) return;
    const timer = window.setInterval(() => {
      const pending = readPendingOperation(pendingQuizKey(problem.id));
      if (!pending) {
        setPendingQuiz(null);
        setGenerating(false);
        setError("Quiz generation timed out. Try again.");
        return;
      }
      void loadSession({ silent: true });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadSession, pendingQuiz, problem.id]);

  async function generateQuiz(action: "generate" | "regenerate" | "nextBatch") {
    const pendingKey = pendingQuizKey(problem.id);
    const operation = writePendingOperation(pendingKey, action);
    setPendingQuiz(operation);
    setGenerating(true);
    setError(null);
    setFeedback(null);
    setShowResults(false);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/quiz`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ action }),
      });
      const json = (await res.json().catch(() => null)) as { session?: QuizSession; error?: string } | null;
      if (!res.ok || !json?.session) throw new Error(json?.error ?? `HTTP ${res.status}`);
      if (session) clearStoredQuizFeedback(problem.id, session.id);
      clearStoredQuizFeedback(problem.id, json.session.id);
      clearPendingOperation(pendingKey);
      setPendingQuiz(null);
      setSession(json.session);
      setSavedItemIds(new Set());
      setCurrentIndex(getFirstUnansweredQuizIndex(json.session));
    } catch (e) {
      clearPendingOperation(pendingKey);
      setPendingQuiz(null);
      setError(e instanceof Error ? e.message : "Failed to generate quiz");
    } finally {
      setGenerating(false);
    }
  }

  async function submitAnswer(item: QuizItem, selectedIndex: number) {
    if (!session || isQuizItemAnswered(session, item.id) || submittingItem) return;
    setSubmittingItem(true);
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/quiz/${session.id}`, {
        method: "PATCH",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ itemId: item.id, selectedIndex }),
      });
      const json = (await res.json().catch(() => null)) as {
        session?: QuizSession;
        item?: QuizItem;
        answer?: QuizAnswer;
        error?: string;
      } | null;
      if (!res.ok || !json?.session || !json.item || !json.answer) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      setSession(json.session);
      storeQuizFeedback(problem.id, json.session.id, json.item.id);
      setFeedback({ item: json.item, answer: json.answer });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit answer");
    } finally {
      setSubmittingItem(false);
    }
  }

  async function saveAsCard(item: QuizItem) {
    if (!session) return;
    setSavingItemId(item.id);
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/quiz/${session.id}/save-card`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ itemId: item.id }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setSavedItemIds((prev) => new Set(prev).add(item.id));
      void onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save card");
    } finally {
      setSavingItemId(null);
    }
  }

  async function saveMissedAsCards() {
    if (!session || savingMissed) return;
    const missedItems = getMissedQuizItems(session).filter((item) => !savedItemIds.has(item.id));
    if (missedItems.length === 0) return;
    setSavingMissed(true);
    try {
      for (const item of missedItems) {
        await saveAsCard(item);
      }
    } finally {
      setSavingMissed(false);
    }
  }

  function goNext() {
    if (!session) return;
    if (feedback) clearStoredQuizFeedback(problem.id, session.id);
    setFeedback(null);
    setCurrentIndex(getNextUnansweredQuizIndex(session, currentIndex));
  }

  function goToQuestion(index: number) {
    if (!session) return;
    if (feedback) clearStoredQuizFeedback(problem.id, session.id);
    setFeedback(null);
    setCurrentIndex(clampNumber(index, 0, session.itemsJson.length - 1));
  }

  if (loading) {
    return <div className="quiz-empty"><p className="popup-muted">Loading quiz...</p></div>;
  }

  if (pendingQuiz) {
    return (
      <div className="quiz-empty">
        <div className="quiz-pending-bar"><span /></div>
        <div className="quiz-empty-title">Generating quiz</div>
        <p className="popup-muted">You can switch to Card or Notes and come back here.</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="quiz-empty">
        <div className="quiz-empty-kicker">Quiz</div>
        <div className="quiz-empty-title">No quiz yet</div>
        <p className="popup-muted">Generate 5 focused questions from this problem, your submissions, notes, and cards.</p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={generating}
          onClick={() => void generateQuiz("generate")}
        >
          {generating ? "Generating..." : "Generate quiz"}
        </button>
        {error && <div className="err-banner quiz-error">{error}</div>}
      </div>
    );
  }

  if (session.status === "completed" && !feedback) {
    const suggested = getSuggestedRating(session.score ?? 0);
    const missedItems = getMissedQuizItems(session);
    const unsavedMissedCount = missedItems.filter((item) => !savedItemIds.has(item.id)).length;
    const accuracy = Math.round(((session.score ?? 0) / Math.max(1, session.itemsJson.length)) * 100);
    const scopeBreakdown = getQuizBreakdown(session, "scope");
    const sourceBreakdown = getQuizBreakdown(session, "source");
    const missedScopes = Array.from(new Set(missedItems.map((item) => item.scope))).map(formatQuizScope);
    return (
      <div className="quiz-panel">
        <div className="quiz-results scroll-area">
          <div className="quiz-overview-card">
            <div className="quiz-overview-main">
              <div className="quiz-score-card">
                <div className="quiz-score-value">
                  {session.score ?? 0}<span>/{session.itemsJson.length}</span>
                </div>
                <div className="quiz-score-label">{accuracy}% · {suggested.label}</div>
              </div>
              <div className="quiz-overview-copy">
                <div className="quiz-overview-title">Batch complete</div>
                <div className="quiz-overview-meta">
                  {missedItems.length === 0 ? "No misses" : `${missedItems.length} missed`} · coverage balanced
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-inline quiz-next-batch"
                disabled={generating}
                onClick={() => void generateQuiz("nextBatch")}
              >
                {generating ? "Generating..." : "New Batch"}
              </button>
            </div>

            <div className="quiz-overview-rows">
              <QuizBreakdown label="Scope" items={scopeBreakdown} />
              <QuizBreakdown label="Source" items={sourceBreakdown} />
            </div>

            <div className="quiz-missed-row">
              <div>
                <span className="quiz-missed-label">Missed</span>
                <span>{missedScopes.length > 0 ? missedScopes.join(" · ") : "None"}</span>
              </div>
              <button
                type="button"
                className="quiz-missed-save"
                disabled={unsavedMissedCount === 0 || savingMissed}
                onClick={() => void saveMissedAsCards()}
              >
                {savingMissed ? "Creating..." : unsavedMissedCount === 0 ? "Cards saved" : "Create cards"}
                {unsavedMissedCount > 0 && !savingMissed && <span>{unsavedMissedCount}</span>}
              </button>
            </div>
          </div>

          <div className="quiz-review-toggle-wrap">
            <button type="button" className="quiz-review-toggle" onClick={() => setShowResults((value) => !value)}>
              <span>{showResults ? "Hide Quiz" : "Review Quiz"}</span>
              <span>{showResults ? "Hide all answers" : "Expand all questions"}</span>
            </button>
          </div>
          {showResults && session.itemsJson.map((item, index) => {
            const answer = session.answersJson.find((a) => a.itemId === item.id) ?? null;
            const correctChoice = item.choices[item.answerIndex] ?? "";
            const selectedChoice = answer ? item.choices[answer.selectedIndex] : null;
            const saved = savedItemIds.has(item.id);
            const saving = savingItemId === item.id;
            return (
              <div key={item.id} className="quiz-result-item">
                <div className="quiz-result-meta">
                  <span>Question {index + 1}</span>
                  <span className={answer?.correct ? "quiz-ok" : "quiz-bad"}>
                    {answer?.correct ? "Correct" : "Incorrect"}
                  </span>
                </div>
                <div className="quiz-result-tags">
                  <span>{QUIZ_SOURCE_LABELS[item.source]}</span>
                  <span>{formatQuizScope(item.scope)}</span>
                </div>
                <PopupMarkdown>{formatQuizMarkdown(item.question)}</PopupMarkdown>
                {selectedChoice && (
                  <div className="quiz-result-line">
                    Your answer: <PopupMarkdown className="popup-md-inline">{formatQuizMarkdown(selectedChoice)}</PopupMarkdown>
                  </div>
                )}
                <div className="quiz-result-line">
                  Correct answer: <PopupMarkdown className="popup-md-inline">{formatQuizMarkdown(correctChoice)}</PopupMarkdown>
                </div>
                <PopupMarkdown>{formatQuizMarkdown(item.explanation)}</PopupMarkdown>
                <button
                  type="button"
                  className={`quiz-result-save${saved ? " is-saved" : ""}`}
                  disabled={saved || saving}
                  onClick={() => void saveAsCard(item)}
                >
                  {saved ? "Saved" : saving ? "Saving..." : "Save"}
                </button>
              </div>
            );
          })}
        </div>
        {error && <div className="err-banner quiz-error">{error}</div>}
      </div>
    );
  }

  const item = session.itemsJson[currentIndex] ?? session.itemsJson[0];
  if (!item) {
    return (
      <div className="quiz-empty">
        <p className="popup-muted">This quiz has no questions.</p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={generating}
          onClick={() => void generateQuiz("regenerate")}
        >
          {generating ? "Regenerating..." : "Regenerate quiz"}
        </button>
      </div>
    );
  }

  const answeredCount = session.answersJson.length;
  const activeAnswer = session.answersJson.find((answer) => answer.itemId === item.id) ?? null;
  const activeFeedback = feedback?.item.id === item.id ? feedback : activeAnswer ? { item, answer: activeAnswer } : null;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < session.itemsJson.length - 1;
  const progressPct = Math.max(8, (answeredCount / session.itemsJson.length) * 100);

  return (
    <div className="quiz-panel">
      <div className="quiz-panel-head">
        <div>
          <div className="quiz-head-title">Question {currentIndex + 1} / {session.itemsJson.length}</div>
          <div className="quiz-head-meta">Answered {answeredCount}/{session.itemsJson.length}</div>
          <div className="quiz-progress"><span style={{ width: `${progressPct}%` }} /></div>
        </div>
        <div className="quiz-nav-row">
          <button
            type="button"
            className="quiz-link-btn"
            disabled={!canGoPrev}
            onClick={() => goToQuestion(currentIndex - 1)}
          >
            Prev
          </button>
          <button
            type="button"
            className="quiz-link-btn"
            disabled={!canGoNext}
            onClick={() => goToQuestion(currentIndex + 1)}
          >
            Next
          </button>
          <button
            type="button"
            className="quiz-link-btn quiz-link-muted"
            disabled={generating}
            onClick={() => void generateQuiz("regenerate")}
          >
            Regenerate
          </button>
        </div>
      </div>
      <div className="quiz-active scroll-area">
        <div className="quiz-question">
          <PopupMarkdown>{formatQuizMarkdown(item.question)}</PopupMarkdown>
        </div>
        <div className="quiz-choices">
          {item.choices.map((choice, index) => {
            const wasSelected = activeFeedback?.answer.selectedIndex === index;
            const isCorrect = activeFeedback && item.answerIndex === index;
            return (
              <button
                key={index}
                type="button"
                disabled={!!activeFeedback || submittingItem}
                onClick={() => void submitAnswer(item, index)}
                className={`quiz-choice${isCorrect ? " is-correct" : ""}${activeFeedback && wasSelected && !isCorrect ? " is-wrong" : ""}`}
              >
                <span className="quiz-choice-letter">{String.fromCharCode(65 + index)}</span>
                <PopupMarkdown>{formatQuizMarkdown(choice)}</PopupMarkdown>
              </button>
            );
          })}
        </div>
        {activeFeedback ? (
          <div className={`quiz-feedback${activeFeedback.answer.correct ? " is-correct" : " is-wrong"}`}>
            <div className="quiz-feedback-head">
              <div className="quiz-feedback-title">{activeFeedback.answer.correct ? "Correct" : "Wrong"}</div>
              <span>{QUIZ_SOURCE_LABELS[item.source]} · {formatQuizScope(item.scope)}</span>
            </div>
            <div className="quiz-feedback-body">
              <PopupMarkdown>{formatQuizMarkdown(item.explanation)}</PopupMarkdown>
            </div>
            <div className="quiz-actions">
              <button
                type="button"
                className="quiz-save-btn"
                disabled={savedItemIds.has(item.id) || savingItemId === item.id}
                onClick={() => void saveAsCard(item)}
              >
                {savedItemIds.has(item.id) ? "Saved" : savingItemId === item.id ? "Saving..." : "Save"}
              </button>
              <button type="button" className="btn btn-primary btn-inline" onClick={goNext}>
                {session.status === "completed" ? "Results" : "Next"}
              </button>
            </div>
          </div>
        ) : (
          <div className="quiz-hint-row">
            <p className="quiz-hint">{submittingItem ? "Checking answer..." : "Click an option to answer, or use Next to skip for now."}</p>
            {answeredCount < session.itemsJson.length && !canGoNext && (
              <button type="button" className="quiz-link-btn" onClick={() => goToQuestion(getFirstUnansweredQuizIndex(session))}>
                First unanswered
              </button>
            )}
          </div>
        )}
        {error && <div className="err-banner quiz-error">{error}</div>}
      </div>
    </div>
  );
}

function getFirstUnansweredQuizIndex(session: QuizSession | null) {
  if (!session) return 0;
  const idx = session.itemsJson.findIndex((item) => !session.answersJson.some((answer) => answer.itemId === item.id));
  return idx === -1 ? 0 : idx;
}

function getNextUnansweredQuizIndex(session: QuizSession, currentIndex: number) {
  const afterCurrent = session.itemsJson.findIndex((item, index) => index > currentIndex && !isQuizItemAnswered(session, item.id));
  if (afterCurrent !== -1) return afterCurrent;
  return getFirstUnansweredQuizIndex(session);
}

function isQuizItemAnswered(session: QuizSession, itemId: string) {
  return session.answersJson.some((answer) => answer.itemId === itemId);
}

function getQuizItemIndex(session: QuizSession | null, itemId: string) {
  if (!session) return 0;
  const idx = session.itemsJson.findIndex((item) => item.id === itemId);
  return idx === -1 ? getFirstUnansweredQuizIndex(session) : idx;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function quizFeedbackStorageKey(problemId: string, sessionId: string) {
  return `ankify.quiz.pendingFeedback.${problemId}.${sessionId}`;
}

function storeQuizFeedback(problemId: string, sessionId: string, itemId: string) {
  window.sessionStorage.setItem(quizFeedbackStorageKey(problemId, sessionId), itemId);
}

function clearStoredQuizFeedback(problemId: string, sessionId: string) {
  window.sessionStorage.removeItem(quizFeedbackStorageKey(problemId, sessionId));
}

function getStoredQuizFeedback(problemId: string, session: QuizSession | null) {
  if (!session) return null;
  const itemId = window.sessionStorage.getItem(quizFeedbackStorageKey(problemId, session.id));
  if (!itemId) return null;
  const item = session.itemsJson.find((quizItem) => quizItem.id === itemId);
  const answer = session.answersJson.find((quizAnswer) => quizAnswer.itemId === itemId);
  if (!item || !answer) {
    clearStoredQuizFeedback(problemId, session.id);
    return null;
  }
  return { item, answer };
}

function QuizBreakdown({ label, items }: { label: string; items: { label: string; count: number }[] }) {
  return (
    <div className="quiz-breakdown-row">
      <span className="quiz-breakdown-label">{label}</span>
      <div className="quiz-breakdown">
        {items.map((item) => (
          <span key={item.label}>{item.label} <b>{item.count}</b></span>
        ))}
      </div>
    </div>
  );
}

function getMissedQuizItems(session: QuizSession) {
  return session.itemsJson.filter((item) => {
    const answer = session.answersJson.find((a) => a.itemId === item.id);
    return answer && !answer.correct;
  });
}

function getQuizBreakdown(session: QuizSession, field: "scope" | "source") {
  const counts = new Map<string, number>();
  session.itemsJson.forEach((item) => {
    const key = field === "scope" ? formatQuizScope(item.scope) : QUIZ_SOURCE_LABELS[item.source];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
}

function formatQuizScope(scope: QuizItem["scope"]) {
  return QUIZ_SCOPE_LABELS[scope];
}

function getSuggestedRating(score: number): { rating: FsrsRating; label: string } {
  if (score <= 1) return { rating: 1, label: "Again" };
  if (score === 2) return { rating: 2, label: "Hard" };
  if (score <= 4) return { rating: 3, label: "Good" };
  return { rating: 4, label: "Easy" };
}

/* ── ManageView ── */

function ManageView({
  problem,
  cards,
  candidates,
  settings,
  due,
  mode,
  onModeChange,
  onRefresh,
}: {
  problem: ApiProblem;
  cards: ApiCard[];
  candidates: ApiCard[];
  settings: ExtSettings;
  due: boolean;
  mode: "review" | "manage";
  onModeChange: (m: "review" | "manage") => void;
  onRefresh: () => void;
}) {
  return (
    <div className="stack">
      <ProblemCard problem={problem} settings={settings} due={due} mode={mode} onModeChange={onModeChange} />

      <div className="panel">
        <div className="section-label">Add a card</div>
        <AddCardForm problem={problem} settings={settings} onAdded={onRefresh} />
      </div>

      {candidates.length > 0 && (
        <CandidateList
          problem={problem}
          candidates={candidates}
          settings={settings}
          onRefresh={onRefresh}
        />
      )}

      <div>
        <div className="section-label">
          {cards.length} saved card{cards.length === 1 ? "" : "s"}
        </div>
        {cards.length === 0 ? (
          <div className="panel panel-quiet">
            <p className="popup-muted" style={{ margin: 0, textAlign: "center" }}>
              No saved cards yet.
            </p>
          </div>
        ) : (
          <CardList cards={cards} settings={settings} onRefresh={onRefresh} />
        )}
      </div>
    </div>
  );
}

/* ── CardFlipper ── */

function CardFlipper({ cards }: { cards: ApiCard[] }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Reset flip when card changes
  useEffect(() => {
    setFlipped(false);
  }, [idx]);

  // Keyboard: Space flips, ←/→ navigates (ignore when typing)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowLeft") {
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setIdx((i) => Math.min(cards.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cards.length]);

  const card = cards[idx];
  if (!card) return null;

  return (
    <div className="card-flipper">
      <div
        className="card-flipper-stage"
        onClick={() => setFlipped((f) => !f)}
        role="button"
        tabIndex={0}
        aria-label={flipped ? "Show question" : "Show answer"}
      >
        <div className={`card-flipper-inner${flipped ? " is-flipped" : ""}`}>
          <div className="card-face card-face-front">
            <div className="card-face-label">Question</div>
            <div className="card-face-content scroll-area">
              <PopupMarkdown className="card-face-md">{card.question}</PopupMarkdown>
            </div>
            <div className="card-face-hint">Tap or press Space</div>
          </div>
          <div className="card-face card-face-back">
            <div className="card-face-label card-face-label-answer">Answer</div>
            <div className="card-face-content scroll-area">
              <PopupMarkdown className="card-face-md">{card.answer}</PopupMarkdown>
            </div>
            <div className="card-face-hint">Tap to flip back</div>
          </div>
        </div>
      </div>

      <div className="card-flipper-nav">
        <button
          type="button"
          className="card-flipper-arrow"
          disabled={idx === 0}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          aria-label="Previous card"
        >
          ←
        </button>
        <span className="card-flipper-pos">
          {idx + 1} / {cards.length}
        </span>
        <button
          type="button"
          className="card-flipper-arrow"
          disabled={idx >= cards.length - 1}
          onClick={() => setIdx((i) => Math.min(cards.length - 1, i + 1))}
          aria-label="Next card"
        >
          →
        </button>
      </div>
    </div>
  );
}

/* ── NotesPanel (auto-save) ── */

function NotesPanel({ problem, settings }: { problem: ApiProblem; settings: ExtSettings }) {
  const [notes, setNotes] = useState(problem.notes ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const savedRef = useRef(notes);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function persist(value: string) {
    if (value === savedRef.current) return;
    setStatus("saving");
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}`, {
        method: "PATCH",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ notes: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      savedRef.current = value;
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1200);
    } catch {
      setStatus("idle");
    }
  }

  function scheduleSave(value: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(value), 600);
  }

  function flushSave() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void persist(notes);
  }

  return (
    <div className="notes-panel">
      <div className="notes-panel-header">
        <span className="section-label" style={{ margin: 0 }}>Notes</span>
        <span className={`notes-panel-status${status !== "idle" ? " is-visible" : ""}`}>
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
        </span>
      </div>
      <textarea
        className="notes-panel-textarea scroll-area"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          scheduleSave(e.target.value);
        }}
        onBlur={flushSave}
        placeholder="What tripped you up, key insights, alternative approaches…"
      />
    </div>
  );
}

/* ── QuickRate ── */

function QuickRate({
  problemId,
  previews,
  settings,
  onRated,
}: {
  problemId: string;
  previews: Previews;
  settings: ExtSettings;
  onRated: () => void;
}) {
  const [rating, setRating] = useState<FsrsRating>(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/review/rate`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ problemId, rating }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      onRated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rate failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="quick-rate">
      <div className="rate-row">
        {RATING_BUTTONS.map((b) => {
          const active = rating === b.rating;
          const interval = formatInterval(previews?.[b.rating]?.due);
          return (
            <button
              key={b.rating}
              type="button"
              className={`rate-btn rate-btn-flat${active ? " rate-btn-active" : ""}`}
              title={b.hint}
              onClick={() => setRating(b.rating)}
            >
              <span className="rate-btn-label">{b.label}</span>
              <span className="rate-btn-interval">{interval}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-primary rate-submit"
        disabled={busy}
        onClick={submit}
      >
        {busy ? "…" : "Submit"}
      </button>

      {error && <div className="err-banner" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

/* ── CardList (saved cards) ── */

function CardList({
  cards,
  settings,
  onRefresh,
}: {
  cards: ApiCard[];
  settings: ExtSettings;
  onRefresh: () => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteCard(cardId: string) {
    if (!window.confirm("Delete this card?")) return;
    setDeletingId(cardId);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/cards`, {
        method: "DELETE",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ ids: [cardId] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      onRefresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {cards.map((card) => (
        <Collapse key={card.id} header={<span className="card-q-preview">{card.question}</span>}>
          <div className="card-q-box">
            <div className="card-q-label">Question</div>
            <PopupMarkdown>{card.question}</PopupMarkdown>
          </div>
          <div className="card-a-box">
            <div className="card-a-label">Answer</div>
            <PopupMarkdown>{card.answer}</PopupMarkdown>
          </div>
          <button
            type="button"
            className="btn-xs btn-xs-danger"
            style={{ marginTop: 10 }}
            disabled={deletingId === card.id}
            onClick={() => deleteCard(card.id)}
          >
            {deletingId === card.id ? "…" : "Delete"}
          </button>
        </Collapse>
      ))}
    </>
  );
}

/* ── AddCardForm ── */

function AddCardForm({
  problem,
  settings,
  onAdded,
}: {
  problem: ApiProblem;
  settings: ExtSettings;
  onAdded: () => void;
}) {
  const slug = problem.leetcodeSlug;
  const [mode, setMode] = useState<"manual" | "ai">("ai");
  const [busy, setBusy] = useState<false | "manual" | "auto" | "note">(false);
  const [pendingAiCard, setPendingAiCard] = useState<PendingOperation | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* manual */
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  /* AI */
  const [rawText, setRawText] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const userEditedRef = useRef(false);

  useEffect(() => {
    userEditedRef.current = false;
    let cancelled = false;
    void getCardDraft(slug).then((saved) => {
      if (cancelled) return;
      if (!userEditedRef.current) setRawText(saved);
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => void setCardDraft(slug, rawText), 380);
    return () => clearTimeout(t);
  }, [rawText, slug, hydrated]);

  const refreshPendingAiCard = useCallback(() => {
    const pending = readPendingOperation(pendingAiCardKey(problem.id));
    setPendingAiCard(pending);
    if (pending?.kind === "auto" || pending?.kind === "note") {
      setBusy(pending.kind);
    } else {
      setBusy((current) => (current === "auto" || current === "note" ? false : current));
    }
    return pending;
  }, [problem.id]);

  useEffect(() => {
    refreshPendingAiCard();
  }, [refreshPendingAiCard]);

  useEffect(() => {
    const key = pendingAiCardKey(problem.id);
    const handlePendingChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key && detail.key !== key) return;
      refreshPendingAiCard();
    };
    window.addEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
    return () => window.removeEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
  }, [problem.id, refreshPendingAiCard]);

  useEffect(() => {
    if (!pendingAiCard) return;
    const timer = window.setInterval(() => {
      const pending = readPendingOperation(pendingAiCardKey(problem.id));
      if (!pending) {
        setPendingAiCard(null);
        setBusy((current) => (current === "auto" || current === "note" ? false : current));
        setError("AI card generation timed out. Try again.");
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [pendingAiCard, problem.id]);

  const updateRawText = (v: string) => {
    userEditedRef.current = true;
    setRawText(v.slice(0, 6000));
  };

  async function clearLocalDraft() {
    await clearCardDraft(slug);
    userEditedRef.current = false;
    setRawText("");
  }

  async function handleManualSave() {
    if (!question.trim() || !answer.trim()) return;
    setBusy("manual");
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/user-card`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ mode: "manual", question: question.trim(), answer: answer.trim() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setQuestion("");
      setAnswer("");
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAiGenerate(kind: "auto" | "note") {
    if (kind === "note" && !rawText.trim()) return;
    const pendingKey = pendingAiCardKey(problem.id);
    const operation = writePendingOperation(pendingKey, kind);
    setPendingAiCard(operation);
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/ai-cards`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({
          mode: "single",
          action: "generate",
          ...(kind === "note" ? { rawText: rawText.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      if (kind === "note") await clearLocalDraft();
      clearPendingOperation(pendingKey);
      setPendingAiCard(null);
      onAdded();
    } catch (e) {
      clearPendingOperation(pendingKey);
      setPendingAiCard(null);
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mode-tabs">
        <button type="button" className={`mode-tab${mode === "ai" ? " active" : ""}`} onClick={() => setMode("ai")}>
          AI from notes
        </button>
        <button type="button" className={`mode-tab${mode === "manual" ? " active" : ""}`} onClick={() => setMode("manual")}>
          Manual Q&A
        </button>
      </div>

      {mode === "manual" && (
        <div className="stack">
          <label className="field-label">
            Question
            <textarea
              className="textarea-card field-ta"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What do you want to recall?"
              disabled={!!busy}
            />
          </label>
          <label className="field-label">
            Answer
            <textarea
              className="textarea-card field-ta"
              rows={4}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="The answer you need to remember."
              disabled={!!busy}
            />
          </label>
          {error && <div className="err-banner">{error}</div>}
          <button
            type="button"
            onClick={handleManualSave}
            disabled={!!busy || !question.trim() || !answer.trim()}
            className="btn btn-primary"
          >
            {busy ? "Saving…" : "Save card"}
          </button>
        </div>
      )}

      {mode === "ai" && (
        <div className="stack">
          <label className="field-label">
            Your notes
            <textarea
              className="textarea-card field-ta"
              rows={5}
              value={rawText}
              onChange={(e) => updateRawText(e.target.value)}
              placeholder="Questions, pitfalls, or reasoning you want to remember..."
              disabled={!!busy}
            />
          </label>
          <div className="ai-toolbar">
            <span className="draft-hint">
              {pendingAiCard ? "Generating candidate…" : `${rawText.length}/6000${rawText.trim() && hydrated ? " · autosaved" : ""}`}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {rawText.trim() && (
                <button type="button" className="link-quiet btn-inline" onClick={clearLocalDraft} disabled={!!busy}>
                  Clear
                </button>
              )}
              <button type="button" onClick={() => handleAiGenerate("auto")} disabled={!!busy} className="btn btn-ghost">
                {busy === "auto" ? "Generating…" : "Auto generate"}
              </button>
              <button
                type="button"
                onClick={() => handleAiGenerate("note")}
                disabled={!rawText.trim() || !!busy}
                className="btn btn-primary"
              >
                {busy === "note" ? "Generating…" : "Generate from note"}
              </button>
            </div>
          </div>

          {error && <div className="err-banner">{error}</div>}
        </div>
      )}
    </div>
  );
}

/* ── CandidateList ── */

function CandidateList({
  problem,
  candidates,
  settings,
  onRefresh,
}: {
  problem: ApiProblem;
  candidates: ApiCard[];
  settings: ExtSettings;
  onRefresh: () => void;
}) {
  const [local, setLocal] = useState<
    (ApiCard & { instruction: string; busy: string | null; localError: string | null })[]
  >([]);
  const [pendingVersion, setPendingVersion] = useState(0);

  useEffect(() => {
    setLocal((prev) => {
      const prevById = new Map(prev.map((c) => [c.id, c]));
      return candidates.map((c) => ({
        ...c,
        instruction: prevById.get(c.id)?.instruction ?? "",
        busy: readPendingOperation(pendingCandidateAiKey(problem.id, c.id)) ? "followup" : prevById.get(c.id)?.busy ?? null,
        localError: prevById.get(c.id)?.localError ?? null,
      }));
    });
  }, [candidates, pendingVersion, problem.id]);

  useEffect(() => {
    const handlePendingChange = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key && !key.startsWith(`ankify.pending.aiCandidate.${problem.id}.`)) return;
      setPendingVersion((value) => value + 1);
    };
    window.addEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
    return () => window.removeEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
  }, [problem.id]);

  useEffect(() => {
    if (!local.some((card) => card.busy === "followup")) return;
    const timer = window.setInterval(() => setPendingVersion((value) => value + 1), 2500);
    return () => window.clearInterval(timer);
  }, [local]);

  function update(id: string, patch: Record<string, unknown>) {
    setLocal((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function patchCard(id: string, body: Record<string, unknown>) {
    const res = await fetch(`${settings.apiBaseUrl}/api/cards/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(settings),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(j?.error ?? `HTTP ${res.status}`);
    }
  }

  async function runAi(
    card: ApiCard & { instruction: string; busy: string | null; localError: string | null },
    instruction?: string,
  ) {
    const pendingKey = pendingCandidateAiKey(problem.id, card.id);
    writePendingOperation(pendingKey, "followup");
    update(card.id, { busy: "followup", localError: null });
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/ai-cards`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({
          mode: "single",
          action: "followup",
          cardId: card.id,
          draft: { question: card.question.trim(), answer: card.answer.trim() },
          instruction,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      clearPendingOperation(pendingKey);
      update(card.id, { busy: null, instruction: "" });
      onRefresh();
    } catch (e) {
      clearPendingOperation(pendingKey);
      update(card.id, { busy: null, localError: e instanceof Error ? e.message : "AI request failed" });
    }
  }

  async function confirm(id: string, q: string, a: string) {
    update(id, { busy: "confirm", localError: null });
    try {
      await patchCard(id, { aiStatus: "ready", question: q.trim(), answer: a.trim() });
      onRefresh();
    } catch (e) {
      update(id, { busy: null, localError: e instanceof Error ? e.message : "Confirm failed" });
    }
  }

  async function discard(id: string) {
    update(id, { busy: "discard", localError: null });
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/cards`, {
        method: "DELETE",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      onRefresh();
    } catch (e) {
      update(id, { busy: null, localError: e instanceof Error ? e.message : "Discard failed" });
    }
  }

  return (
    <div className="panel">
      <div className="section-label">
        {candidates.length} AI candidate{candidates.length !== 1 ? "s" : ""} — review &amp; confirm
      </div>
      {local.map((c) => {
        const disabled = !!c.busy;
        return (
          <div key={c.id} className={`candidate-card${c.aiStatus === "failed" ? " candidate-failed" : ""}`}>
            <div
              className="candidate-status"
              style={{
                color: c.aiStatus === "failed" ? "var(--danger)" : "var(--muted)",
              }}
            >
              {c.aiStatus === "failed" ? "Failed" : "Candidate"}
            </div>
            {c.errorMessage && <div className="err-banner" style={{ marginBottom: 8 }}>{c.errorMessage}</div>}

            <label className="field-label">
              Q
              <textarea
                className="textarea-card field-ta-sm"
                rows={2}
                value={c.question}
                disabled={disabled}
                onChange={(e) => update(c.id, { question: e.target.value })}
              />
            </label>
            <label className="field-label">
              A
              <textarea
                className="textarea-card field-ta-sm"
                rows={3}
                value={c.answer}
                disabled={disabled}
                onChange={(e) => update(c.id, { answer: e.target.value })}
              />
            </label>
            <div className="candidate-followup">
              <input
                className="followup-input"
                value={c.instruction}
                disabled={disabled}
                onChange={(e) => update(c.id, { instruction: e.target.value })}
                placeholder="Follow up instruction (optional)"
              />
              <div className="candidate-actions">
                <button
                  type="button"
                  className="btn-xs"
                  disabled={disabled || !c.question.trim() || !c.answer.trim() || !c.instruction.trim()}
                  onClick={() => runAi(c, c.instruction)}
                >
                  {c.busy === "followup" ? "…" : "Apply"}
                </button>
                <button
                  type="button"
                  className="btn-xs btn-xs-accent"
                  disabled={disabled || !c.question.trim() || !c.answer.trim()}
                  onClick={() => confirm(c.id, c.question, c.answer)}
                >
                  {c.busy === "confirm" ? "…" : "Confirm"}
                </button>
                <button type="button" className="btn-xs btn-xs-danger" disabled={!!c.busy} onClick={() => discard(c.id)}>
                  ×
                </button>
              </div>
            </div>
            {c.localError && <div className="err-banner" style={{ marginTop: 6 }}>{c.localError}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ── CaptureView ── */

function CaptureView({
  slug,
  settings,
  onCaptured,
  onError,
}: {
  slug: string;
  settings: ExtSettings;
  onCaptured: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CapturedProblem | null>(null);

  async function readPage() {
    setBusy(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab.");
      const resp = (await chrome.tabs.sendMessage(tab.id, {
        type: "capture_current_problem",
      })) as ContentResponse;
      if (resp.type !== "captured") {
        throw new Error(resp.type === "error" ? resp.message : "Unexpected response");
      }
      setPreview(resp.data);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function saveCapture() {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/capture`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify(preview),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      onCaptured();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  if (!preview) {
    return (
      <div className="panel">
        <span className="section-label">Not in your deck</span>
        <p className="popup-muted" style={{ marginTop: 0 }}>
          Problem <span className="popup-code">{slug}</span> hasn&apos;t been captured.
        </p>
        <button type="button" onClick={readPage} disabled={busy} className="btn btn-primary" style={{ marginTop: 14 }}>
          {busy ? "Reading…" : "Capture this problem"}
        </button>
      </div>
    );
  }

  const accepted = preview.submissions.filter((s) => s.status === "Accepted").length;
  const failed = preview.submissions.length - accepted;
  return (
    <div className="panel">
      <div className="hero-row">
        <div style={{ minWidth: 0 }}>
          <h2 className="hero-title">{preview.title}</h2>
          <div className="hero-meta">
            {preview.difficulty} · {preview.topicTags.slice(0, 4).join(", ")}
          </div>
        </div>
      </div>
      <p className="capture-meta" style={{ marginTop: 12 }}>
        {preview.submissions.length} submissions
        {preview.submissions.length > 0 && ` (${accepted} accepted, ${failed} failed)`}
      </p>
      <div className="capture-actions" style={{ marginTop: 16 }}>
        <button type="button" onClick={saveCapture} disabled={busy} className="btn btn-primary">
          {busy ? "Saving…" : "Add to ankify"}
        </button>
        <button type="button" onClick={() => setPreview(null)} disabled={busy} className="btn btn-secondary">
          Back
        </button>
      </div>
    </div>
  );
}

/* ── SettingsTab ── */

function SettingsTab({
  settings,
  theme,
  onThemeChange,
  onSave,
}: {
  settings: ExtSettings;
  theme: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
  onSave: (next: ExtSettings) => void;
}) {
  const [base, setBase] = useState(settings.apiBaseUrl);
  const [token, setToken] = useState(settings.apiToken);
  const [savedFlash, setSavedFlash] = useState(false);
  const [testState, setTestState] = useState<{ kind: "idle" | "loading" | "success" | "error"; message: string }>({
    kind: "idle",
    message: "",
  });

  const normalizedBase = base.trim().replace(/\/+$/, "");

  async function testConnection() {
    if (!normalizedBase || !token.trim()) {
      setTestState({ kind: "error", message: "API base URL and token are required." });
      return;
    }

    setTestState({ kind: "loading", message: "Checking connection…" });
    try {
      const res = await fetch(`${normalizedBase}/api/me`, {
        headers: token.trim() ? { "x-ankify-token": token.trim() } : {},
      });
      const data = (await res.json().catch(() => null)) as { user?: { email?: string }; error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error || `Connection failed (${res.status})`);
      }
      setTestState({ kind: "success", message: `Connected as ${data?.user?.email ?? "this user"}.` });
    } catch (error) {
      setTestState({ kind: "error", message: error instanceof Error ? error.message : "Connection failed." });
    }
  }

  return (
    <div className="settings-stack">
      <section className="settings-module panel" aria-labelledby="settings-appearance">
        <div className="settings-module-head">
          <strong id="settings-appearance">Appearance</strong>
          <p>Theme only affects the extension popup.</p>
        </div>
        <div className="theme-control settings-theme-control" aria-label="Theme">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              data-active={theme === option.value}
              onClick={() => onThemeChange(option.value)}
              aria-pressed={theme === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-module panel" aria-labelledby="settings-connection">
        <div className="settings-module-head">
          <strong id="settings-connection">Connection</strong>
          <p>Used when the extension talks to the web API.</p>
        </div>
        <label>
          API base URL
          <input type="text" value={base} onChange={(e) => setBase(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label>
          User API token
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </label>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onSave({ apiBaseUrl: normalizedBase, apiToken: token.trim() });
              setBase(normalizedBase);
              setToken(token.trim());
              setSavedFlash(true);
              setTimeout(() => setSavedFlash(false), 2000);
            }}
          >
            Save connection
          </button>
          <button type="button" className="btn btn-secondary" onClick={testConnection} disabled={testState.kind === "loading"}>
            {testState.kind === "loading" ? "Testing…" : "Test connection"}
          </button>
          <p className="popup-muted">
            {savedFlash ? "Saved." : "Create a token in web Settings, then paste it here."}
          </p>
        </div>
        {testState.message ? (
          <p className={`connection-status connection-status-${testState.kind}`}>{testState.message}</p>
        ) : null}
      </section>
    </div>
  );
}
