import { getSettings, SETTINGS_KEY } from "../shared/storage";

const LOCATION_EVENT = "ankify:locationchange";
const RESET_WAIT_MS = 18_000;

let started = false;
let scheduledReset: number | undefined;
let activeSlug: string | null = null;
let lastResetSlug: string | null = null;
let lastSeenUrl = window.location.href;

type PatchedWindow = Window & {
  __ankifyResetLocationPatched?: boolean;
};

export function startAutoResetCodeOnProblemPages(): void {
  if (started) return;
  started = true;

  patchHistoryEvents();
  window.addEventListener(LOCATION_EVENT, () => scheduleResetCheck(700));
  window.addEventListener("popstate", () => scheduleResetCheck(700));
  window.addEventListener("hashchange", () => scheduleResetCheck(700));
  window.setInterval(() => {
    if (window.location.href === lastSeenUrl) return;
    lastSeenUrl = window.location.href;
    scheduleResetCheck(700);
  }, 1_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleResetCheck(250);
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    lastResetSlug = null;
    scheduleResetCheck(150);
  });

  scheduleResetCheck(700);
}

function patchHistoryEvents() {
  const w = window as PatchedWindow;
  if (w.__ankifyResetLocationPatched) return;
  w.__ankifyResetLocationPatched = true;

  const originalPushState = history.pushState.bind(history);
  history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
    const result = originalPushState(data, unused, url);
    window.dispatchEvent(new Event(LOCATION_EVENT));
    return result;
  }) as History["pushState"];

  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
    const result = originalReplaceState(data, unused, url);
    window.dispatchEvent(new Event(LOCATION_EVENT));
    return result;
  }) as History["replaceState"];
}

function scheduleResetCheck(delayMs: number) {
  if (scheduledReset != null) {
    window.clearTimeout(scheduledReset);
  }
  scheduledReset = window.setTimeout(() => {
    scheduledReset = undefined;
    void maybeResetCurrentProblem();
  }, delayMs);
}

async function maybeResetCurrentProblem() {
  const slug = slugFromUrl();
  if (!slug || slug === activeSlug || slug === lastResetSlug) return;

  activeSlug = slug;
  try {
    const settings = await getSettings();
    if (!settings.resetCodeOnProblemOpen) return;

    const result = await resetCodeToDefault();
    if (result.clicked) {
      lastResetSlug = slug;
      console.info("[ankify] reset LeetCode code to default", { slug, confirmed: result.confirmed });
    }
  } catch (error) {
    console.warn("[ankify] failed to reset LeetCode code", error);
  } finally {
    if (activeSlug === slug) activeSlug = null;
  }
}

function slugFromUrl(): string | null {
  const m = window.location.pathname.match(/^\/problems\/([^/]+)/);
  return m?.[1] ?? null;
}

async function resetCodeToDefault(): Promise<{ clicked: boolean; confirmed: boolean }> {
  const button = await waitFor(findEditorResetButton, RESET_WAIT_MS);
  if (!button) return { clicked: false, confirmed: false };

  button.click();
  const confirmed = await confirmResetIfPrompted();
  return { clicked: true, confirmed };
}

function findEditorResetButton(): HTMLButtonElement | null {
  const editor = document.querySelector<HTMLElement>('[aria-label="Editor content"], .monaco-editor');
  const editorRect = editor?.getBoundingClientRect();
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));

  return (
    buttons.find((button) => {
      if (!isVisible(button) || !button.querySelector('svg[data-icon="arrow-rotate-left"]')) return false;
      if (!editorRect) return true;

      const rect = button.getBoundingClientRect();
      const aboveEditor = rect.bottom <= editorRect.top + 12 && rect.bottom >= editorRect.top - 96;
      const horizontallyAligned = rect.left >= editorRect.left - 160 && rect.right <= editorRect.right + 80;
      return aboveEditor && horizontallyAligned;
    }) ?? null
  );
}

async function confirmResetIfPrompted(): Promise<boolean> {
  const confirmButton = await waitFor(findResetConfirmButton, 2_500, 100);
  if (!confirmButton) return false;
  confirmButton.click();
  return true;
}

function findResetConfirmButton(): HTMLElement | null {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], .modal, [class*="modal"], [class*="Modal"]',
    ),
  ).filter(isVisible);

  for (const dialog of dialogs) {
    const dialogText = visibleText(dialog);
    if (!/reset|default code|默认|重置|恢复/i.test(dialogText)) continue;

    const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button, [role="button"]')).filter(isVisible);
    const target = buttons.find((button) => {
      const text = visibleText(button);
      if (/cancel|close|取消|关闭/i.test(text)) return false;
      return /^(confirm|reset|ok|yes)$/i.test(text) || /reset|default code|确认|重置|恢复默认/i.test(text);
    });
    if (target) return target;
  }

  return null;
}

function visibleText(el: HTMLElement): string {
  return `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""}`.replace(/\s+/g, " ").trim();
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

async function waitFor<T>(read: () => T | null, timeoutMs: number, intervalMs = 250): Promise<T | null> {
  const startedAt = Date.now();
  let value = read();
  while (!value && Date.now() - startedAt < timeoutMs) {
    await delay(intervalMs);
    value = read();
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
