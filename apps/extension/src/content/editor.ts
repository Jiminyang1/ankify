import type { EditorReadFailure, EditorSnapshot } from "../shared/messages";

const REQUEST = "ankify:editor-request";
const RESPONSE = "ankify:editor-response";
const TIMEOUT_MS = 1_500;
/** Matches the Coach context limit (agentLeetcodeContextSchema). */
const MAX_CODE = 20_000;

/** Asks editor-main.ts, in the page's own context, for the editor's code.
 *  Without it, says why: the page script never answered (it isn't injected),
 *  LeetCode's Monaco isn't on the page, or no editor holds code. */
export function readEditor(): Promise<{ editor: EditorSnapshot } | { editor: null; reason: EditorReadFailure }> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => finish({ editor: null, reason: "no_page_script" }), TIMEOUT_MS);
    function finish(value: { editor: EditorSnapshot } | { editor: null; reason: EditorReadFailure }) {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(value);
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as { type?: unknown; id?: unknown; editor?: unknown; reason?: unknown } | null;
      if (!data || data.type !== RESPONSE || data.id !== id) return;
      const editor = data.editor as { language?: unknown; code?: unknown } | null;
      if (!editor || typeof editor.language !== "string" || typeof editor.code !== "string" || !editor.language) {
        finish({ editor: null, reason: data.reason === "no_monaco" ? "no_monaco" : "no_code_model" });
        return;
      }
      finish({ editor: { language: editor.language.slice(0, 64), code: editor.code.slice(0, MAX_CODE) } });
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: REQUEST, id }, window.location.origin);
  });
}
