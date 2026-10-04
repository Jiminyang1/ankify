/**
 * Runs in LeetCode's own page context (manifest `world: "MAIN"`), the only
 * place `window.monaco` is visible. Answers one question for the isolated
 * content script: what is in the code editor right now?
 *
 * Self-contained on purpose (no imports), so the build inlines it instead of
 * emitting a loader that needs `chrome.runtime`, which MAIN world lacks.
 */

type MonacoModel = { getValue(): string; getLanguageId(): string; isDisposed?(): boolean };
type MonacoEditor = { getModel(): MonacoModel | null };
type MonacoGlobal = { editor?: { getEditors?(): MonacoEditor[]; getModels?(): MonacoModel[] } };

const REQUEST = "ankify:editor-request";
const RESPONSE = "ankify:editor-response";

function codeModel(): MonacoModel | null {
  const monaco = (window as unknown as { monaco?: MonacoGlobal }).monaco;
  if (!monaco?.editor) return null;
  // Mounted editors first: LeetCode also mounts a plaintext test-case editor.
  const mounted = (monaco.editor.getEditors?.() ?? [])
    .map((editor) => editor.getModel())
    .filter((model): model is MonacoModel => model != null);
  const candidates = mounted.length > 0 ? mounted : (monaco.editor.getModels?.() ?? []);
  return candidates.find((model) => !model.isDisposed?.() && model.getLanguageId() !== "plaintext") ?? null;
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { type?: unknown; id?: unknown } | null;
  if (!data || data.type !== REQUEST || typeof data.id !== "string") return;
  const model = codeModel();
  window.postMessage(
    {
      type: RESPONSE,
      id: data.id,
      editor: model ? { language: model.getLanguageId(), code: model.getValue() } : null,
    },
    window.location.origin,
  );
});
