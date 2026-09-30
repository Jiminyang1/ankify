/**
 * Resets LeetCode's code editor to the problem's default code, as an explicit
 * user action (never automatically on page open): it clicks LeetCode's own
 * reset control and confirms its dialog.
 */
const RESET_WAIT_MS = 4_000;

export async function resetEditorToDefault(): Promise<boolean> {
  const result = await resetCodeToDefault();
  return result.clicked;
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
