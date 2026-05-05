import { useCallback, useEffect, useRef, useState } from "react";
import type { CapturedProblem, ContentResponse, ExtSettings } from "../shared/messages";
import { clearCardDraft, getCardDraft, getSettings, setCardDraft, setSettings } from "../shared/storage";

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
};
type FsrsRating = 1 | 2 | 3 | 4;
type Previews = Record<FsrsRating, { due: string }>;

type State =
  | { kind: "detecting" }
  | { kind: "off-page" }
  | { kind: "loading"; slug: string }
  | { kind: "not-saved"; slug: string }
  | { kind: "captured"; problem: ApiProblem; cards: ApiCard[]; candidates: ApiCard[]; previews: Previews }
  | { kind: "error"; msg: string };

type NavTab = "today" | "this-problem" | "settings";

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
  { rating: 1, label: "Again", hint: "完全想不起来" },
  { rating: 2, label: "Hard", hint: "想起一点但不稳" },
  { rating: 3, label: "Good", hint: "能讲出主要方法" },
  { rating: 4, label: "Easy", hint: "能讲清方法、复杂度和坑" },
];

/* ── helpers ── */

function jsonHeaders(settings: ExtSettings): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiToken) h["x-ankify-token"] = settings.apiToken;
  return h;
}

function authHeaders(settings: ExtSettings): HeadersInit {
  return settings.apiToken ? { "x-ankify-token": settings.apiToken } : {};
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
      <div className={`collapse-body${open ? " collapse-body-open" : ""}`}>
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
        <div className="popup-brand">
          <span className="popup-brand-title">ankify</span>
          <span className="popup-brand-tag">LC</span>
        </div>
        {tab !== "settings" && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (tab === "this-problem") void detect();
              else window.dispatchEvent(new CustomEvent("ankify:refresh-today"));
            }}
            title="Refresh"
          >
            Refresh
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="popup-nav">
        {(["today", "this-problem", "settings"] as NavTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className="popup-nav-tab"
            data-active={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "today" ? "Today" : t === "this-problem" ? "This Problem" : "Settings"}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="popup-main">
        {tab === "today" && settings && (
          <TodayTab
            settings={settings}
            onJumpToProblem={() => setTab("this-problem")}
          />
        )}

        {tab === "this-problem" && settings && (
          <ThisProblemTab
            state={state}
            settings={settings}
            captured={captured}
            onRefresh={detect}
            onError={(msg) => setState({ kind: "error", msg })}
          />
        )}

        {tab === "settings" && settings && (
          <SettingsTab
            settings={settings}
            onSave={(next) => {
              void setSettings(next);
              setLocalSettings((prev) => (prev ? { ...prev, ...next } : prev));
            }}
          />
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <a
          href={`${settings.apiBaseUrl}/review`}
          target="_blank"
          rel="noreferrer"
          className="hero-link"
        >
          Open full review on web ↗
        </a>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>
    </div>
  );
}

/* ── ThisProblemTab ── */

function ThisProblemTab({
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
  if (state.kind === "detecting") return <p className="popup-muted">Connecting…</p>;
  if (state.kind === "loading") return <p className="popup-muted">Syncing <span className="popup-code">{state.slug}</span>…</p>;

  if (state.kind === "off-page") {
    return (
      <div className="panel panel-quiet">
        <p className="popup-muted" style={{ margin: 0 }}>
          Open a <strong style={{ color: "var(--fg)" }}>LeetCode problem</strong> tab (URL contains{" "}
          <span className="popup-code">/problems/</span>) to capture it or review the problem here. The Today tab still works on any page.
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

  return (
    <div className="stack">
      {/* Problem header */}
      <div className="panel">
        <div className="hero-row">
          <div style={{ minWidth: 0 }}>
            <h2 className="hero-title">{problem.title}</h2>
            <div className="hero-meta">
              <span className={`pill pill-${problem.difficulty.toLowerCase()}`}>{problem.difficulty}</span>{" "}
              <span className="pill pill-state">{problem.fsrsState}</span>{" "}
              {due && <span className="pill pill-due">due</span>}
            </div>
          </div>
          <a
            href={`${settings.apiBaseUrl}/problems/${problem.id}`}
            target="_blank"
            rel="noreferrer"
            className="hero-link"
          >
            Web ↗
          </a>
        </div>
        <div className="hero-stats">
          <span>Reps: {problem.fsrsReps}</span>
          <span>Lapses: {problem.fsrsLapses}</span>
          {problem.fsrsStability != null && (
            <span>Stability: {problem.fsrsStability.toFixed(1)}d</span>
          )}
        </div>
      </div>

      {/* Quick Rate */}
      <div className="panel">
        <div className="section-label">Quick Review</div>
        {due ? (
          <QuickRate
            problemId={problem.id}
            previews={previews}
            settings={settings}
            onRated={onRefresh}
          />
        ) : (
          <p className="popup-muted" style={{ margin: 0, textAlign: "center" }}>
            Next review: <strong style={{ color: "var(--fg)" }}>{formatInterval(problem.fsrsDue)}</strong>
          </p>
        )}
      </div>

      {/* Add card */}
      <div className="panel">
        <div className="section-label">Add a card</div>
        <AddCardForm problem={problem} settings={settings} onAdded={onRefresh} />
      </div>

      {/* AI candidates */}
      {candidates.length > 0 && (
        <CandidateList
          problem={problem}
          candidates={candidates}
          settings={settings}
          onRefresh={onRefresh}
        />
      )}

      {/* Saved cards */}
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
      <div className="rate-grid">
        {RATING_BUTTONS.map((b) => {
          const active = rating === b.rating;
          const interval = formatInterval(previews?.[b.rating]?.due);
          return (
            <button
              key={b.rating}
              type="button"
              className={`rate-btn${active ? " rate-btn-active" : ""}`}
              onClick={() => setRating(b.rating)}
            >
              <span className="rate-btn-label">{b.label}</span>
              <span className="rate-btn-interval">{interval}</span>
              <span className="rate-btn-hint">{b.hint}</span>
            </button>
          );
        })}
      </div>

      {error && <div className="err-banner" style={{ marginTop: 10 }}>{error}</div>}

      <button
        type="button"
        className="btn btn-primary"
        style={{ marginTop: 12, width: "100%" }}
        disabled={busy}
        onClick={submit}
      >
        {busy ? "Submitting…" : "Submit Rating"}
      </button>
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
          <div className="card-a-box">
            <div className="card-a-label">Answer</div>
            <div className="card-a-text">{card.answer}</div>
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
      onAdded();
    } catch (e) {
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
              placeholder="刚做完时的疑惑、坑、想记住的推理…"
              disabled={!!busy}
            />
          </label>
          <div className="ai-toolbar">
            <span className="draft-hint">
              {rawText.length}/6000{rawText.trim() && hydrated ? " · autosaved" : ""}
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

  useEffect(() => {
    setLocal((prev) => {
      const prevById = new Map(prev.map((c) => [c.id, c]));
      return candidates.map((c) => ({
        ...c,
        instruction: prevById.get(c.id)?.instruction ?? "",
        busy: prevById.get(c.id)?.busy ?? null,
        localError: prevById.get(c.id)?.localError ?? null,
      }));
    });
  }, [candidates]);

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
      update(card.id, { busy: null, instruction: "" });
      onRefresh();
    } catch (e) {
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
  onSave,
}: {
  settings: ExtSettings;
  onSave: (next: ExtSettings) => void;
}) {
  const [base, setBase] = useState(settings.apiBaseUrl);
  const [token, setToken] = useState(settings.apiToken);
  const [savedFlash, setSavedFlash] = useState(false);

  return (
    <div className="settings-stack panel">
      <strong style={{ fontFamily: "var(--font-ui)", fontSize: 15 }}>Connection</strong>
      <label>
        API base URL
        <input type="text" value={base} onChange={(e) => setBase(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label>
        API token (ANKIFY_API_TOKEN)
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </label>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          onSave({ apiBaseUrl: base.trim(), apiToken: token });
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 2000);
        }}
      >
        Save settings
      </button>
      <p className="popup-muted" style={{ margin: 0, fontSize: 12 }}>
        {savedFlash ? "Saved." : "Extension sends this token on cross-origin API calls."}
      </p>
    </div>
  );
}
