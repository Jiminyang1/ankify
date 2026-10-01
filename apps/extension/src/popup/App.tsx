import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AuthUserDto,
  CapabilitiesDto,
  PracticeSessionDto,
  ReviewOverviewDto,
  ReviewOverviewProblemDto,
  ReviewOverviewSessionDto,
  SuggestionDto,
} from "@ankify/contracts";
import type { OutboxStatus } from "../background/outbox";
import type { SuggestionsView } from "../background/suggestions";
import type { PageMessage } from "../shared/protocol";
import { relativeDay, strings, type ExtensionStrings, type Language } from "../shared/i18n";
import { getSettings, setSettings } from "../shared/storage";
import { ask, type BridgeOutcome } from "./bridge";
import { BackIcon, Button, GearIcon, Segmented, Spinner, SyncIcon } from "./ui";

type Theme = "system" | "light" | "dark";
type Auth = { kind: "loading" } | { kind: "signed_in"; user: AuthUserDto } | { kind: "signed_out" } | { kind: "unknown" };

const API_ORIGIN = __ANKIFY_DEFAULT_API_ORIGIN__;
const THEME_KEY = "ankify.theme";

/** Closes the toolbar popup after navigating; a copy opened in a tab stays. */
async function closePopup() {
  if (!(await chrome.tabs.getCurrent())) window.close();
}

function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function App() {
  const [language, setLanguage] = useState<Language>("en");
  const [theme, setTheme] = useState<Theme>("system");
  const [auth, setAuth] = useState<Auth>({ kind: "loading" });
  const [view, setView] = useState<"main" | "settings">("main");
  const t = strings(language);

  useEffect(() => {
    void getSettings().then((settings) => setLanguage(settings.language));
    void chrome.storage.local.get(THEME_KEY).then((stored) => {
      const saved = stored[THEME_KEY];
      if (saved === "light" || saved === "dark" || saved === "system") {
        setTheme(saved);
        applyTheme(saved);
      }
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const checkAuth = useCallback(async () => {
    setAuth({ kind: "loading" });
    const result = await ask<Auth | { ok: false }>({ type: "auth_status" });
    setAuth("kind" in result ? result : { kind: "unknown" });
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  if (auth.kind === "loading") {
    return (
      <div className="popup">
        <div className="center">
          <Spinner label={t.common.loading} />
        </div>
      </div>
    );
  }
  if (auth.kind === "signed_out") return <SignIn t={t} onRecheck={checkAuth} />;
  if (view === "settings") {
    return (
      <SettingsView
        t={t}
        language={language}
        theme={theme}
        user={auth.kind === "signed_in" ? auth.user : null}
        onBack={() => setView("main")}
        onLanguage={(next) => {
          setLanguage(next);
          void setSettings({ language: next });
        }}
        onTheme={(next) => {
          setTheme(next);
          applyTheme(next);
          void chrome.storage.local.set({ [THEME_KEY]: next });
        }}
      />
    );
  }
  return <MainView t={t} language={language} onOpenSettings={() => setView("settings")} />;
}

function SignIn({ t, onRecheck }: { t: ExtensionStrings; onRecheck: () => void }) {
  return (
    <div className="popup">
      <header className="topbar">
        <span className="brand">{t.brand}</span>
      </header>
      <main className="content">
        <section className="panel stack">
          <h1 className="title">{t.popup.signInTitle}</h1>
          <p className="muted">{t.popup.signInBody}</p>
          <Button
            variant="primary"
            block
            onClick={() => void chrome.tabs.create({ url: `${API_ORIGIN}/login?next=%2Fextension-connected` })}
          >
            {t.common.signIn}
          </Button>
          <Button block onClick={onRecheck}>
            {t.popup.signInAgain}
          </Button>
        </section>
      </main>
    </div>
  );
}

function SyncChip({ t, status }: { t: ExtensionStrings; status: OutboxStatus | null }) {
  if (!status || (status.pending === 0 && status.blocked === 0)) return null;
  const label = status.blocked > 0 ? t.sync.blocked(status.blocked) : t.sync.pending(status.pending);
  return (
    <span className="chip" data-tone={status.blocked > 0 ? "danger" : "warning"} title={label}>
      <SyncIcon />
      {status.blocked > 0 ? status.blocked : status.pending}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

type ItemMessage = { key: string; text: string; confirm?: { label: string; run: () => void } } | null;

function MainView({ t, language, onOpenSettings }: { t: ExtensionStrings; language: Language; onOpenSettings: () => void }) {
  const [overview, setOverview] = useState<ReviewOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<OutboxStatus | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesDto | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<ItemMessage>(null);

  const refreshSeq = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const [result, status, caps] = await Promise.all([
      ask<BridgeOutcome<ReviewOverviewDto>>({ type: "overview" }),
      ask<OutboxStatus | null>({ type: "sync_status" }),
      ask<BridgeOutcome<CapabilitiesDto>>({ type: "capabilities" }),
    ]);
    // A later read supersedes this one.
    if (seq !== refreshSeq.current) return;
    if (result.ok && !result.queued) {
      setOverview(result.response);
      setError(null);
    } else if (!result.ok) {
      setError(result.error);
    }
    setSync(status && "pending" in status ? status : null);
    if (caps.ok && !caps.queued) setCapabilities(caps.response);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A rating, finish, or sync on a problem page (or a delayed sync) shows up
  // here without reopening the popup.
  useEffect(() => {
    const listener = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.id === chrome.runtime.id && (message as { type?: unknown } | null)?.type === "session_changed") void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  async function run(key: string, action: () => Promise<BridgeOutcome<unknown>>, onError?: (error: string) => ItemMessage) {
    setBusyKey(key);
    setMessage(null);
    const result = await action();
    setBusyKey(null);
    if (!result.ok) {
      setMessage(onError?.(result.error) ?? { key, text: t.errors[result.error] ?? t.common.unknownError });
      return false;
    }
    await refresh();
    return true;
  }

  async function openReview(item: ReviewOverviewProblemDto, supersedePendingRating = false) {
    const key = `due:${item.id}`;
    const opened = await run(
      key,
      () => ask({ type: "open_review", problemId: item.id, slug: item.leetcodeSlug, supersedePendingRating }),
      (code) =>
        code === "rating_pending"
          ? { key, text: t.popup.supersedeConfirm, confirm: { label: t.popup.startNewReview, run: () => void openReview(item, true) } }
          : { key, text: t.errors[code] ?? t.common.unknownError },
    );
    if (opened) void closePopup();
  }

  const openProblem = (slug: string) => void ask({ type: "open_problem", slug }).then(closePopup);

  const noticeFor = (key: string) =>
    message?.key === key ? (
      <div className="notice" role="alert">
        <p>{message.text}</p>
        {message.confirm && (
          <Button size="sm" variant="danger" onClick={message.confirm.run}>
            {message.confirm.label}
          </Button>
        )}
      </div>
    ) : null;

  return (
    <div className="popup">
      <header className="topbar">
        <span className="brand">{t.brand}</span>
        <div className="topbar-actions">
          <SyncChip t={t} status={sync} />
          <Button variant="ghost" size="sm" className="icon-button" aria-label={t.settings.title} onClick={onOpenSettings}>
            <GearIcon />
          </Button>
        </div>
      </header>
      <main className="content">
        {error && (
          <section className="panel stack">
            <p>{t.errors[error] ?? t.common.unknownError}</p>
            <Button size="sm" onClick={() => void refresh()}>
              {t.common.retry}
            </Button>
          </section>
        )}
        {capabilities && !capabilities.supportedWorkflows.includes("practice_sessions") && (
          <section className="panel" role="alert">
            {t.popup.serverOutdated}
          </section>
        )}
        <CurrentProblemSection t={t} />
        {!overview && !error && (
          <div className="center">
            <Spinner label={t.common.loading} />
          </div>
        )}
        {overview && (
          <>
            {overview.openSessions.length > 0 && (
              <Section title={t.popup.continue}>
                {overview.openSessions.map((item) => (
                  <SessionRow
                    key={item.session.id}
                    t={t}
                    item={item}
                    busy={busyKey === `session:${item.session.id}`}
                    notice={noticeFor(`session:${item.session.id}`)}
                    onOpen={() => openProblem(item.problem.leetcodeSlug)}
                    onAbandon={() =>
                      void run(`session:${item.session.id}`, () =>
                        ask({ type: "session_control", sessionId: item.session.id, control: { command: "abandon", occurredAt: new Date().toISOString() } }),
                      )
                    }
                  />
                ))}
              </Section>
            )}
            {overview.pendingRatings.length > 0 && (
              <Section title={t.popup.rate}>
                {overview.pendingRatings.map((item) => (
                  <RatingCard
                    key={item.session.id}
                    t={t}
                    language={language}
                    item={item}
                    busy={busyKey === `rating:${item.session.id}`}
                    notice={noticeFor(`rating:${item.session.id}`)}
                    onRate={(rating) => void run(`rating:${item.session.id}`, () => ask({ type: "session_rating", sessionId: item.session.id, rating }))}
                    onDecide={(decision) =>
                      void run(`rating:${item.session.id}`, () => ask({ type: "session_rating_decision", sessionId: item.session.id, decision }))
                    }
                  />
                ))}
              </Section>
            )}
            <Section title={t.popup.due}>
              {overview.due.length === 0 ? (
                <p className="muted empty">{overview.queue.remaining === 0 && overview.counts.dueNow > 0 ? t.popup.limitReached : t.popup.nothingDue}</p>
              ) : (
                <ul className="list">
                  {overview.due.map((item) => (
                    <li key={item.id}>
                      <button type="button" className="row-button" disabled={busyKey != null} onClick={() => void openReview(item)}>
                        <span className="row-title">{item.title}</span>
                        <span className="row-meta">
                          <span className={`difficulty difficulty-${item.difficulty.toLowerCase()}`}>{item.difficulty}</span>
                          <span>{item.overdueDays > 0 ? t.popup.overdue(item.overdueDays) : t.popup.dueToday}</span>
                          {busyKey === `due:${item.id}` && <Spinner />}
                        </span>
                      </button>
                      {noticeFor(`due:${item.id}`)}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            {overview.upcoming.length > 0 && (
              <Section title={t.popup.upcoming}>
                <ul className="list">
                  {overview.upcoming.slice(0, 6).map((item) => (
                    <li key={item.id}>
                      <button type="button" className="row-button" onClick={() => openProblem(item.leetcodeSlug)}>
                        <span className="row-title">{item.title}</span>
                        <span className="row-meta">{relativeDay(item.fsrsDue, language)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {capabilities?.supportedWorkflows.includes("suggestions") && <SuggestionsSection t={t} />}
            <NotesSection t={t} />
            <footer className="footer">
              <span className="muted small">
                {t.popup.reviewsToday(overview.counts.reviewsToday)}
                {overview.counts.initialLearningToday > 0 ? ` · ${t.popup.firstPracticesToday(overview.counts.initialLearningToday)}` : ""}
              </span>
              <a href={`${API_ORIGIN}/today`} target="_blank" rel="noreferrer">
                {t.common.openDashboard}
              </a>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

function SessionRow({
  t,
  item,
  busy,
  notice,
  onOpen,
  onAbandon,
}: {
  t: ExtensionStrings;
  item: ReviewOverviewSessionDto;
  busy: boolean;
  notice: React.ReactNode;
  onOpen: () => void;
  onAbandon: () => void;
}) {
  const interrupted = item.session.status === "interrupted";
  return (
    <div className="panel stack">
      <div className="row-between">
        <span className="row-title">{item.problem.title}</span>
        <span className="chip" data-tone={interrupted ? "warning" : "success"}>
          {interrupted ? t.popup.interrupted : t.popup.active}
        </span>
      </div>
      <p className="muted small">
        {t.kinds[item.session.type]} · {t.panel.evidence(item.session.evidence.submissions, item.session.evidence.accepted)}
      </p>
      <div className="row">
        <Button size="sm" variant="primary" onClick={onOpen}>
          {interrupted ? t.panel.resume : t.popup.open}
        </Button>
        {interrupted ? (
          <Button size="sm" variant="danger" pending={busy} onClick={onAbandon}>
            {t.popup.abandon}
          </Button>
        ) : (
          <span className="muted small">{t.popup.finishInTab}</span>
        )}
      </div>
      {notice}
    </div>
  );
}

function RatingCard({
  t,
  language,
  item,
  busy,
  notice,
  onRate,
  onDecide,
}: {
  t: ExtensionStrings;
  language: Language;
  item: { session: PracticeSessionDto; problem: ReviewOverviewSessionDto["problem"] };
  busy: boolean;
  notice: React.ReactNode;
  onRate: (rating: 1 | 2 | 3 | 4) => void;
  onDecide: (decision: "defer" | "dismiss") => void;
}) {
  const grades = [
    { grade: 1 as const, label: t.rating.again, hint: t.rating.hints.again },
    { grade: 2 as const, label: t.rating.hard, hint: t.rating.hints.hard },
    { grade: 3 as const, label: t.rating.good, hint: t.rating.hints.good },
    { grade: 4 as const, label: t.rating.easy, hint: t.rating.hints.easy },
  ];
  return (
    <div className="panel stack" role="group" aria-label={`${t.rating.prompt} ${item.problem.title}`}>
      <span className="row-title">{item.problem.title}</span>
      <p className="muted small">{t.rating.promptHint}</p>
      <div className="ratings">
        {grades.map(({ grade, label, hint }) => (
          <button key={grade} type="button" className="rating" data-grade={grade} disabled={busy} onClick={() => onRate(grade)}>
            <span className="rating-label">{label}</span>
            <span className="rating-hint">{hint}</span>
          </button>
        ))}
      </div>
      <div className="row">
        {item.session.rating.disposition === "pending" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("defer")}>
            {t.rating.later}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("dismiss")}>
          {t.rating.skip}
        </Button>
        {busy && <Spinner />}
      </div>
      {item.session.rating.expiresAt && <p className="muted small">{t.rating.expires(relativeDay(item.session.rating.expiresAt, language))}</p>}
      {notice}
    </div>
  );
}

/** Today's new-problem suggestions: the day's one, extras, and replacements. */
function SuggestionsSection({ t }: { t: ExtensionStrings }) {
  const [view, setView] = useState<SuggestionsView | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await ask<BridgeOutcome<SuggestionsView>>({ type: "suggestions" });
    if (result.ok && !result.queued) {
      setView(result.response);
      setExhausted(result.response.exhausted);
    } else if (!result.ok) {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run<T>(key: string, message: PageMessage, after?: (response: T) => void) {
    setBusyKey(key);
    setError(null);
    const result = await ask<BridgeOutcome<T>>(message);
    setBusyKey(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    if (!result.queued) after?.(result.response);
    await load();
    return true;
  }

  const visible = view?.suggestions.filter((suggestion) => suggestion.status === "pending" || suggestion.status === "started") ?? [];
  return (
    <Section title={t.suggestions.title}>
      {error && (
        <div className="notice" role="alert">
          <p>{t.errors[error] ?? t.common.unknownError}</p>
        </div>
      )}
      {!view && !error && <Spinner label={t.common.loading} />}
      {view && visible.length === 0 && exhausted && <p className="muted empty">{t.suggestions.none}</p>}
      {visible.map((suggestion) => (
        <SuggestionCard
          key={suggestion.id}
          t={t}
          suggestion={suggestion}
          busyKey={busyKey}
          onStart={() =>
            void run(`start:${suggestion.id}`, { type: "suggestion_start", suggestionId: suggestion.id, slug: suggestion.target.slug }).then((started) => {
              if (started) void closePopup();
            })
          }
          onAction={(action) => void run(`${action}:${suggestion.id}`, { type: "suggestion_action", suggestionId: suggestion.id, action })}
          onOpen={() => void ask({ type: "open_problem", slug: suggestion.target.slug }).then(closePopup)}
        />
      ))}
      {view && visible.length > 0 && exhausted && <p className="muted small">{t.suggestions.none}</p>}
      {view && (
        <Button
          size="sm"
          variant="ghost"
          pending={busyKey === "extra"}
          disabled={busyKey != null}
          onClick={() => void run<SuggestionDto | null>("extra", { type: "suggestion_extra" }, (suggestion) => setExhausted(suggestion === null))}
        >
          {t.suggestions.another}
        </Button>
      )}
    </Section>
  );
}

function SuggestionCard({
  t,
  suggestion,
  busyKey,
  onStart,
  onAction,
  onOpen,
}: {
  t: ExtensionStrings;
  suggestion: SuggestionDto;
  busyKey: string | null;
  onStart: () => void;
  onAction: (action: "skip" | "already_attempted") => void;
  onOpen: () => void;
}) {
  const category = (id: string) => t.analysis.categories[id] ?? id;
  const lines = suggestion.reasons.map((reason) => {
    switch (reason.code) {
      case "category_focus":
        return t.suggestions.focus(category(reason.category), reason.contexts);
      case "general_practice":
        return t.suggestions.general[reason.why] ?? "";
      case "similar_to":
        return reason.category ? t.suggestions.similarToMistake(reason.title, category(reason.category)) : t.suggestions.similarTo(reason.title);
      case "topic_match":
        return t.suggestions.topic(reason.topic);
    }
  });
  const { target } = suggestion;
  const busy = busyKey != null;
  return (
    <div className="panel stack" role="group" aria-label={target.title}>
      <div className="row-between">
        <span className="row-title">{target.title}</span>
        <span className={`difficulty difficulty-${target.difficulty.toLowerCase()}`}>{target.difficulty}</span>
      </div>
      <ul className="plain-list small">
        {lines.map((line, index) => (
          <li key={index} className={index === 0 ? undefined : "muted"}>
            {line}
          </li>
        ))}
      </ul>
      {suggestion.status === "pending" ? (
        <>
          <p className="muted small">{t.suggestions.novelty[suggestion.novelty]}</p>
          <div className="row">
            <Button size="sm" variant="primary" pending={busyKey === `start:${suggestion.id}`} disabled={busy} onClick={onStart}>
              {t.suggestions.start}
            </Button>
            <Button size="sm" variant="ghost" pending={busyKey === `skip:${suggestion.id}`} disabled={busy} onClick={() => onAction("skip")}>
              {t.suggestions.skip}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              pending={busyKey === `already_attempted:${suggestion.id}`}
              disabled={busy}
              onClick={() => onAction("already_attempted")}
            >
              {t.suggestions.attempted}
            </Button>
          </div>
        </>
      ) : (
        <div className="row-between">
          <span className="chip" data-tone={suggestion.outcome === "accepted" ? "success" : "warning"}>
            {suggestion.outcome ? t.suggestions.outcome[suggestion.outcome] : t.suggestions.inProgress}
          </span>
          <Button size="sm" variant="secondary" onClick={onOpen}>
            {t.suggestions.open}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The LeetCode problem in the active tab: its practice runs in the page's panel. */
function CurrentProblemSection({ t }: { t: ExtensionStrings }) {
  const [tabId, setTabId] = useState<number | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id != null && /^https:\/\/leetcode\.com\/problems\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/|$)/.test(tab.url ?? "")) setTabId(tab.id);
    });
  }, []);

  if (tabId == null) return null;

  async function openPanel(id: number) {
    try {
      const response = (await chrome.tabs.sendMessage(id, { type: "open_panel" })) as { ok?: boolean } | undefined;
      if (response?.ok) return void closePopup();
    } catch {
      // No content script yet: the tab was open before the extension loaded.
    }
    setMissing(true);
  }

  return (
    <Section title={t.popup.thisProblem}>
      <div className="panel stack">
        <p className="muted small">{missing ? t.popup.panelMissing : t.popup.thisProblemHint}</p>
        {missing ? (
          <Button size="sm" variant="primary" onClick={() => void chrome.tabs.reload(tabId).then(closePopup)}>
            {t.popup.reloadTab}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void openPanel(tabId)}>
            {t.popup.openPanel}
          </Button>
        )}
      </div>
    </Section>
  );
}

type NotesState = { problemId: string; title: string; notes: string } | null | "unavailable";

/** Notes of the problem in the active LeetCode tab, saved as you type. */
function NotesSection({ t }: { t: ExtensionStrings }) {
  const [state, setState] = useState<NotesState>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const slug = tab?.url?.match(/^https:\/\/leetcode\.com\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/)?.[1];
      if (!slug) return setState("unavailable");
      const result = await ask<BridgeOutcome<{ problemId: string; title: string; notes: string } | null>>({ type: "notes_load", slug });
      setState(result.ok && !result.queued && result.response ? result.response : "unavailable");
    })();
    return () => window.clearTimeout(timer.current);
  }, []);

  if (state == null || state === "unavailable") return null;

  function update(notes: string) {
    if (state == null || state === "unavailable") return;
    const problemId = state.problemId;
    setState({ ...state, notes });
    setStatus("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void ask<BridgeOutcome<null>>({ type: "notes_save", problemId, notes }).then((result) => setStatus(result.ok ? "saved" : "failed"));
    }, 800);
  }

  return (
    <Section title={`${t.popup.notesTitle}: ${state.title}`}>
      <textarea
        className="notes"
        value={state.notes}
        placeholder={t.popup.notesPlaceholder}
        aria-label={t.popup.notesTitle}
        onChange={(event) => update(event.target.value)}
      />
      <p className="muted small" aria-live="polite">
        {status === "saving" ? t.popup.notesSaving : status === "saved" ? t.popup.notesSaved : status === "failed" ? t.popup.notesFailed : ""}
      </p>
    </Section>
  );
}

function SettingsView({
  t,
  language,
  theme,
  user,
  onBack,
  onLanguage,
  onTheme,
}: {
  t: ExtensionStrings;
  language: Language;
  theme: Theme;
  user: AuthUserDto | null;
  onBack: () => void;
  onLanguage: (language: Language) => void;
  onTheme: (theme: Theme) => void;
}) {
  const [sync, setSync] = useState<OutboxStatus | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    void ask<OutboxStatus | null>({ type: "sync_status" }).then((status) => setSync(status && "pending" in status ? status : null));
  }, []);

  return (
    <div className="popup">
      <header className="topbar">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <BackIcon />
          {t.settings.back}
        </Button>
        <span className="brand">{t.settings.title}</span>
      </header>
      <main className="content">
        <section className="panel stack">
          <span className="label">{t.settings.language}</span>
          <Segmented
            label={t.settings.language}
            value={language}
            onChange={onLanguage}
            options={[
              { value: "en", label: "English" },
              { value: "zh", label: "中文" },
            ]}
          />
          <span className="label">{t.settings.theme}</span>
          <Segmented
            label={t.settings.theme}
            value={theme}
            onChange={onTheme}
            options={[
              { value: "system", label: t.settings.system },
              { value: "light", label: t.settings.light },
              { value: "dark", label: t.settings.dark },
            ]}
          />
        </section>
        <section className="panel stack">
          <span className="label">{t.settings.account}</span>
          {user && <p>{t.settings.signedInAs(user.email)}</p>}
          <a href={`${API_ORIGIN}/settings`} target="_blank" rel="noreferrer">
            {t.settings.manageOnWeb}
          </a>
        </section>
        <section className="panel stack">
          <span className="label">{t.settings.sync}</span>
          {!sync || (sync.pending === 0 && sync.blocked === 0) ? (
            <p className="muted">{t.sync.synced}</p>
          ) : (
            <>
              {sync.pending > 0 && <p>{t.sync.pending(sync.pending)}</p>}
              {sync.blocked > 0 && (
                <>
                  <p>{t.sync.blocked(sync.blocked)}</p>
                  <p className="muted small">{t.sync.blockedHelp}</p>
                </>
              )}
              <Button
                size="sm"
                pending={retrying}
                onClick={async () => {
                  setRetrying(true);
                  const status = await ask<OutboxStatus | null>({ type: "sync_retry" });
                  setSync(status && "pending" in status ? status : null);
                  setRetrying(false);
                }}
              >
                {t.sync.retry}
              </Button>
            </>
          )}
          {sync && sync.otherAccounts > 0 && <p className="muted small">{t.sync.otherAccount(sync.otherAccounts)}</p>}
          {sync && sync.rejections.length > 0 && (
            <>
              <span className="label">{t.sync.rejected}</span>
              <ul className="plain-list">
                {sync.rejections.slice(-5).map((rejection) => (
                  <li key={rejection.id} className="muted small">
                    {t.errors[rejection.code ?? ""] ?? t.common.unknownError}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
