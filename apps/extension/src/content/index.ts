import type { CaptureSubmissionInput, CaptureResultDto } from "@ankify/contracts";
import { strings, type Language } from "../shared/i18n";
import type { ContentMessage } from "../shared/protocol";
import { createLeetcodeClient } from "./leetcode-client";
import { createPageSession, type BackgroundOutcome, type PageSession } from "./page-session";
import { mountPanel } from "./panel";
import { resetEditorToDefault } from "./reset-code";

/**
 * Content script for LeetCode problem pages: tracks the practice session of
 * the problem in the URL (LeetCode is a single-page app) and renders the
 * panel. All backend traffic goes through the extension's background worker.
 */

const client = createLeetcodeClient();
let language: Language = "en";
let current: { slug: string; page: PageSession; panel: ReturnType<typeof mountPanel> } | null = null;

async function send<T>(message: ContentMessage): Promise<BackgroundOutcome<T>> {
  try {
    return (await chrome.runtime.sendMessage(message)) as BackgroundOutcome<T>;
  } catch {
    // The worker is restarting or the extension was reloaded; treat as offline.
    return { ok: false, error: "offline" };
  }
}

function slugFromLocation() {
  return window.location.pathname.match(/^\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/)?.[1] ?? null;
}

/** Reads the latest page of submissions with details and imports them. */
async function importHistory(slug: string) {
  const [problem, listing] = await Promise.all([client.readProblem(slug), client.listSubmissions(slug, { maxPages: 1 })]);
  if (!problem.value) return { ok: false as const, error: problem.availability === "signed_out" ? "signed_out" : "offline" };
  if (!listing.value) return { ok: false as const, error: listing.availability === "signed_out" ? "signed_out" : "offline" };
  const submissions: CaptureSubmissionInput[] = [];
  for (const submission of listing.value.submissions.filter((item) => !item.pending).slice(0, 20)) {
    const detail = await client.readSubmissionDetail(submission.id);
    if (!detail.value) continue;
    submissions.push({
      ...detail.value,
      leetcodeSubmissionId: submission.id,
      status: submission.verdict,
      ...(submission.submittedAt ? { submittedAt: submission.submittedAt } : {}),
    });
  }
  const result = await send<CaptureResultDto>({ type: "import_history", slug, problem: problem.value, submissions });
  if (!result.ok) return { ok: false as const, error: result.error as string };
  return { ok: true as const, imported: result.queued ? 0 : result.response.importedSubmissions };
}

function mount() {
  const slug = slugFromLocation();
  if (slug === (current?.slug ?? null)) return;
  current?.panel.unmount();
  current?.page.dispose();
  current = null;
  if (!slug) return;
  const page = createPageSession({
    slug,
    client,
    send,
    now: Date.now,
    isActive: () => document.visibilityState === "visible" && document.hasFocus(),
    // LeetCode's result view can take focus from the page; visible is enough to poll.
    isVisible: () => document.visibilityState === "visible",
    schedule: (task, ms) => {
      const timer = window.setTimeout(task, ms);
      return () => window.clearTimeout(timer);
    },
  });
  const panel = mountPanel({
    slug,
    page,
    strings: () => strings(language),
    language: () => language,
    apiOrigin: __ANKIFY_DEFAULT_API_ORIGIN__,
    actions: { resetEditor: resetEditorToDefault, importHistory: () => importHistory(slug) },
  });
  current = { slug, page, panel };
  void page.refresh();
}

void send<{ language: Language }>({ type: "panel_settings" }).then((result) => {
  if (!result.ok || result.queued) return;
  language = result.response.language;
  current?.panel.rerender();
});

// Only this extension can send these: the popup asks the page to show its
// panel, and the worker says a session changed elsewhere (popup, another tab,
// or a delayed sync), so the panel reads the current state.
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  const type = (message as { type?: unknown } | null)?.type;
  if (type === "session_changed") {
    current?.page.onExternalChange();
    return;
  }
  if (type !== "open_panel") return;
  mount();
  current?.panel.expand();
  sendResponse({ ok: Boolean(current) });
});

/** LeetCode's Submit button (by its test locator, else its label). */
function isSubmitButton(target: EventTarget | null) {
  const button = target instanceof Element ? target.closest("button") : null;
  if (!button) return false;
  if (button.getAttribute("data-e2e-locator") === "console-submit-button") return true;
  return /^(submit|提交)$/i.test(button.textContent?.trim() ?? "");
}

// A submit makes the page check LeetCode every few seconds until the verdict
// is in, instead of waiting for the next regular check. Capture phase: the
// editor may stop the key event from bubbling.
document.addEventListener("click", (event) => {
  if (isSubmitButton(event.target)) current?.page.onSubmitIntent();
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) current?.page.onSubmitIntent();
}, true);

const onActivityChange = () => current?.page.onVisibilityChange();
document.addEventListener("visibilitychange", onActivityChange);
window.addEventListener("focus", onActivityChange);
window.addEventListener("blur", onActivityChange);
window.addEventListener("popstate", mount);
// LeetCode navigates between problems with history.pushState, which fires no
// event; the Navigation API reports it where available, the poll everywhere.
(window as Window & { navigation?: EventTarget }).navigation?.addEventListener("navigatesuccess", mount);
window.setInterval(mount, 1_000);
mount();
