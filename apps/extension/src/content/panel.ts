import type { PracticeModeId, PracticeSessionDto } from "@ankify/contracts";
import { relativeDay, type ExtensionStrings, type Language } from "../shared/i18n";
import type { PageNotice, PageSession, PageView } from "./page-session";
import { PANEL_STYLES } from "./panel-styles";

type Child = Node | string | null | false | undefined;
type Attrs = Record<string, string | boolean | undefined | ((event: Event) => void)>;

function h(tag: string, attrs: Attrs = {}, ...children: Child[]) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") element.addEventListener(name.slice(2).toLowerCase(), value);
    else element.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) if (child != null && child !== false) element.append(child);
  return element;
}

const svg = (path: string) => {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  element.setAttribute("viewBox", "0 0 16 16");
  element.setAttribute("fill", "none");
  element.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  shape.setAttribute("stroke", "currentColor");
  shape.setAttribute("stroke-width", "1.8");
  shape.setAttribute("stroke-linecap", "round");
  shape.setAttribute("stroke-linejoin", "round");
  element.append(shape);
  return element;
};
const chevron = (up: boolean) => svg(up ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4");

export type PanelActions = {
  resetEditor(): Promise<boolean>;
  importHistory(): Promise<{ ok: true; imported: number } | { ok: false; error: string }>;
};

type Local = { tone: "neutral" | "warning" | "danger"; text: string } | null;

/**
 * The compact session panel on LeetCode problem pages. It lives in a shadow
 * root, so LeetCode's styles cannot reach it, and it renders the page
 * session's view; every action goes through the page session.
 */
export function mountPanel(deps: {
  slug: string;
  page: PageSession;
  strings: () => ExtensionStrings;
  language: () => Language;
  apiOrigin: string;
  actions: PanelActions;
}) {
  const host = document.createElement("div");
  host.setAttribute("data-ankify-panel", "");
  host.setAttribute("data-slug", deps.slug);
  // Open mode: a page script could hook attachShadow before this document_idle
  // script runs anyway; the shadow root is for style isolation.
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PANEL_STYLES;
  const root = h("div", { class: "root" });
  shadow.append(style, root);
  (document.body ?? document.documentElement).append(host);

  let view: PageView = { kind: "loading" };
  let open = false;
  let local: Local = null;
  let localBusy: "reset" | "import" | null = null;
  let lastStartMode: PracticeModeId = "practice";
  const autoOpened = new Set<string>();

  function attentionKey(next: PageView) {
    if (next.kind !== "ready") return null;
    if (next.pendingRating) return `rating:${next.pendingRating.id}`;
    if (next.notice) return `notice:${JSON.stringify(next.notice)}`;
    const session = next.session;
    if (session && session.ownership !== "you" && (session.status === "active" || session.status === "interrupted")) return `session:${session.id}:${session.status}`;
    return null;
  }

  const unsubscribe = deps.page.subscribe((next) => {
    view = next;
    const key = attentionKey(next);
    if (key && !autoOpened.has(key)) {
      autoOpened.add(key);
      open = true;
    }
    if (next.kind === "ready" && next.notice?.kind === "error" && next.notice.error === "open_session_conflict") {
      void deps.page.refresh();
    }
    render();
  });

  function render() {
    const focusKey = (shadow.activeElement as HTMLElement | null)?.dataset.key;
    root.replaceChildren(...[open ? card() : null, pill()].filter((node): node is HTMLElement => node != null));
    if (focusKey) (root.querySelector(`[data-key="${focusKey}"]`) as HTMLElement | null)?.focus();
  }

  const busy = () => (view.kind === "ready" && view.busy != null) || localBusy != null;

  function button(
    key: string,
    label: string,
    onClick: () => void,
    options: { variant?: "primary" | "secondary" | "ghost" | "danger"; block?: boolean; spinning?: boolean; title?: string } = {},
  ) {
    const variant = options.variant ?? "secondary";
    const classes = ["btn", variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : variant === "danger" ? "btn-ghost btn-danger" : "", options.block ? "btn-block" : ""];
    return h(
      "button",
      { type: "button", class: classes.filter(Boolean).join(" "), "data-key": key, disabled: busy(), title: options.title, onClick: () => onClick() },
      options.spinning ? h("span", { class: "spinner", "aria-hidden": "true" }) : null,
      label,
    );
  }

  function pill() {
    const t = deps.strings();
    const { tone, status } = pillStatus(t);
    return h(
      "button",
      {
        type: "button",
        class: "pill",
        "data-key": "pill",
        // The visible "ankify <status>" is the name; aria-expanded is the state.
        "aria-expanded": open ? "true" : "false",
        onClick: () => {
          open = !open;
          render();
        },
      },
      h("span", { class: "dot", "data-tone": tone }),
      t.brand,
      status ? h("span", { class: "status" }, status) : null,
      chevron(open),
    );
  }

  function pillStatus(t: ExtensionStrings): { tone: string; status: string } {
    if (view.kind === "loading") return { tone: "muted", status: "" };
    if (view.kind === "signed_out") return { tone: "warning", status: t.common.signIn };
    if (view.kind === "offline") return { tone: "warning", status: t.sync.offline };
    if (view.pendingRating) return { tone: "accent", status: t.rating.prompt };
    const session = view.session;
    if (session && !session.stale && (session.status === "active" || session.status === "interrupted")) {
      if (session.status === "interrupted") return { tone: "warning", status: t.popup.interrupted };
      return { tone: "success", status: session.ownership === "you" ? t.kinds[session.type] : t.popup.active };
    }
    if (!view.problem) return { tone: "muted", status: "" };
    if (view.problem.enrollment === "awaiting_initial") return { tone: "accent", status: t.kinds.initial_learning };
    if (view.problem.due) return { tone: "accent", status: t.popup.due };
    return { tone: "muted", status: relativeDay(view.problem.fsrsDue, deps.language()) };
  }

  function card() {
    const t = deps.strings();
    const title = view.kind === "ready" && view.problem ? view.problem.title : t.brand;
    const dashboard = view.kind === "ready" && view.problem ? `${deps.apiOrigin}/problems/${view.problem.id}` : `${deps.apiOrigin}/today`;
    return h(
      "section",
      { class: "card", role: "region", "aria-label": t.brand, onKeyDown: (event) => {
        if ((event as KeyboardEvent).key === "Escape") {
          open = false;
          render();
        }
      } },
      h(
        "header",
        {},
        h("span", { class: "title" }, title),
        h("button", { type: "button", class: "btn btn-icon", "data-key": "collapse", "aria-label": t.common.collapse, onClick: () => {
          open = false;
          render();
        } }, chevron(false)),
      ),
      h("div", { class: "body" }, ...body(t)),
      h("footer", {}, h("a", { href: dashboard, target: "_blank", rel: "noopener" }, view.kind === "ready" && view.problem ? t.common.openInAnkify : t.common.openDashboard)),
    );
  }

  function body(t: ExtensionStrings): Child[] {
    if (view.kind === "loading") return [h("p", { class: "text muted" }, t.common.loading)];
    if (view.kind === "signed_out") {
      return [
        h("p", { class: "text" }, t.panel.signedOut),
        button("sign-in", t.common.signIn, () => window.open(`${deps.apiOrigin}/login?next=%2Fextension-connected`, "_blank", "noopener"), { variant: "primary", block: true }),
      ];
    }
    if (view.kind === "offline") {
      return [h("p", { class: "text" }, t.panel.offline), button("retry", t.common.retry, () => void deps.page.refresh(), { block: true })];
    }
    const blocks: Child[] = [];
    if (view.notice) blocks.push(noticeBlock(t, view.notice));
    if (local) blocks.push(h("p", { class: "notice", "data-tone": local.tone, role: "status" }, local.text));
    if (view.pendingRating) blocks.push(ratingBlock(t, view.pendingRating));
    const session = view.session;
    if (session && !session.stale && (session.status === "active" || session.status === "interrupted")) blocks.push(sessionBlock(t, session));
    else if (!view.pendingRating) blocks.push(startBlock(t));
    return blocks;
  }

  function noticeBlock(t: ExtensionStrings, notice: PageNotice) {
    if (notice.kind === "rated") {
      return h("p", { class: "notice", role: "status" }, t.rating.nextReview(relativeDay(notice.nextDue, deps.language())));
    }
    if (notice.kind === "queued") {
      const text = { finish: t.panel.finishedQueued, abandon: t.panel.abandonedQueued, rating: t.panel.ratingQueued, rating_decision: t.panel.decisionQueued }[notice.action];
      return h("p", { class: "notice", "data-tone": "warning", role: "status" }, text);
    }
    const message = t.errors[notice.error] ?? t.common.unknownError;
    return h(
      "div",
      { class: "stack" },
      h("p", { class: "notice", "data-tone": "danger", role: "alert" }, message),
      notice.error === "rating_pending"
        ? button("start-anyway", t.panel.startAnyway, () => void deps.page.start(lastStartMode, { supersedePendingRating: true }), { variant: "danger" })
        : null,
    );
  }

  function startBlock(t: ExtensionStrings) {
    const problem = view.kind === "ready" ? view.problem : null;
    const starting = view.kind === "ready" && view.busy === "starting";
    const start = (mode: PracticeModeId) => {
      lastStartMode = mode;
      void deps.page.start(mode);
    };
    let status: string;
    let primary: HTMLElement;
    let secondary: HTMLElement | null = null;
    if (!problem) {
      status = t.panel.notTracked;
      primary = button("start", t.panel.startPractice, () => start("practice"), { variant: "primary", block: true, spinning: starting });
    } else if (problem.enrollment === "awaiting_initial") {
      status = t.panel.awaitingInitial;
      primary = button("start", t.panel.startPractice, () => start("practice"), { variant: "primary", block: true, spinning: starting });
    } else if (problem.due) {
      status = t.panel.due;
      primary = button("start", t.panel.startReview, () => start("due_review"), { variant: "primary", block: true, spinning: starting && lastStartMode === "due_review" });
      secondary = button("start-practice", t.panel.practiceWithoutReview, () => start("practice"), { block: true, spinning: starting && lastStartMode === "practice" });
    } else {
      status = t.panel.scheduled(relativeDay(problem.fsrsDue, deps.language()));
      primary = button("start", t.panel.startPractice, () => start("practice"), { variant: "primary", block: true, spinning: starting && lastStartMode === "practice" });
      secondary = button("start-early", t.panel.reviewEarly, () => start("early_review"), { block: true, spinning: starting && lastStartMode === "early_review" });
    }
    return h(
      "div",
      { class: "stack" },
      h("p", { class: "text" }, status),
      primary,
      secondary,
      h(
        "div",
        { class: "row" },
        button("reset", t.panel.resetEditor, () => void runLocal("reset"), { variant: "ghost", spinning: localBusy === "reset" }),
        problem ? button("import", t.panel.importHistory, () => void runLocal("import"), { variant: "ghost", spinning: localBusy === "import" }) : null,
      ),
    );
  }

  function sessionBlock(t: ExtensionStrings, session: PracticeSessionDto) {
    const busyState = view.kind === "ready" ? view.busy : null;
    if (session.status === "interrupted") {
      return h(
        "div",
        { class: "stack" },
        h("p", { class: "text" }, t.panel.interrupted),
        button("resume", t.panel.resume, () => void deps.page.resume(), { variant: "primary", block: true, spinning: busyState === "claiming" }),
        button("abandon", t.panel.abandon, () => void deps.page.abandon(), { variant: "danger", spinning: busyState === "abandoning" }),
      );
    }
    if (session.ownership !== "you") {
      return h(
        "div",
        { class: "stack" },
        h("p", { class: "text" }, t.panel.otherTab),
        button("takeover", t.panel.continueHere, () => void deps.page.takeover(), { variant: "primary", block: true, spinning: busyState === "claiming" }),
      );
    }
    const availability = view.kind === "ready" ? view.availability : "available";
    const minutes = Math.round(session.timing.activeMs / 60_000);
    return h(
      "div",
      { class: "stack" },
      h("p", { class: "text" }, h("span", { class: "badge" }, t.kinds[session.type]), " ", t.panel.inProgress(t.kinds[session.type])),
      h("p", { class: "text muted small" }, t.panel.evidence(session.evidence.submissions, session.evidence.accepted)),
      minutes > 0 ? h("p", { class: "text muted small" }, t.panel.activeTime(minutes)) : null,
      availability !== "available" ? h("p", { class: "notice", "data-tone": "warning" }, t.panel.tracking[availability]) : null,
      button("finish", t.panel.finish, () => void deps.page.finish("solved"), { variant: "primary", block: true, spinning: busyState === "finishing" }),
      session.evidence.accepted === 0 ? h("p", { class: "text muted small" }, t.panel.noAcceptedYet) : null,
      h(
        "div",
        { class: "row" },
        button("end-unsuccessful", t.panel.endUnsuccessful, () => void deps.page.finish("unsuccessful")),
        button("abandon", t.panel.abandon, () => void deps.page.abandon(), { variant: "danger", spinning: busyState === "abandoning" }),
      ),
    );
  }

  function ratingBlock(t: ExtensionStrings, session: PracticeSessionDto) {
    const grades = [
      { grade: 1 as const, label: t.rating.again, hint: t.rating.hints.again },
      { grade: 2 as const, label: t.rating.hard, hint: t.rating.hints.hard },
      { grade: 3 as const, label: t.rating.good, hint: t.rating.hints.good },
      { grade: 4 as const, label: t.rating.easy, hint: t.rating.hints.easy },
    ];
    return h(
      "div",
      { class: "stack", role: "group", "aria-label": t.rating.prompt },
      h("p", { class: "text" }, h("strong", {}, t.rating.prompt)),
      h("p", { class: "text muted small" }, t.rating.promptHint),
      h(
        "div",
        { class: "ratings" },
        ...grades.map(({ grade, label, hint }) =>
          h(
            "button",
            { type: "button", class: "rating", "data-grade": String(grade), "data-key": `rate-${grade}`, disabled: busy(), onClick: () => void deps.page.rate(grade) },
            h("span", { class: "label" }, label),
            h("span", { class: "hint" }, hint),
          ),
        ),
      ),
      h(
        "div",
        { class: "row" },
        session.rating.disposition === "pending" ? button("rate-later", t.rating.later, () => void deps.page.decideRating("defer"), { variant: "ghost" }) : null,
        button("rate-skip", t.rating.skip, () => void deps.page.decideRating("dismiss"), { variant: "ghost" }),
      ),
      session.rating.expiresAt ? h("p", { class: "text muted small" }, t.rating.expires(relativeDay(session.rating.expiresAt, deps.language()))) : null,
    );
  }

  async function runLocal(action: "reset" | "import") {
    const t = deps.strings();
    localBusy = action;
    local = null;
    render();
    try {
      if (action === "reset") {
        local = (await deps.actions.resetEditor())
          ? { tone: "neutral", text: t.panel.resetEditorDone }
          : { tone: "warning", text: t.panel.resetEditorMissing };
      } else {
        const result = await deps.actions.importHistory();
        local = result.ok
          ? { tone: "neutral", text: result.imported > 0 ? t.panel.importHistoryDone(result.imported) : t.panel.importHistoryNone }
          : { tone: "danger", text: t.errors[result.error] ?? t.common.unknownError };
      }
    } finally {
      localBusy = null;
      render();
    }
  }

  render();
  return {
    rerender: render,
    unmount() {
      unsubscribe();
      host.remove();
    },
  };
}
