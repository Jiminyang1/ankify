import { DARK_TOKENS, LIGHT_TOKENS, tokenDeclarations } from "../shared/theme-tokens";

/**
 * Styles for the in-page panel, scoped to its shadow root, so nothing here
 * reaches LeetCode's own page. The palette is the shared LeetCode-native one
 * (`shared/theme-tokens.ts`). The panel follows LeetCode's theme: the content
 * script mirrors it onto the host as `data-theme`; without one it follows the
 * system preference.
 */
export const PANEL_STYLES = `
:host {
  all: initial;
  --font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color-scheme: dark;
${tokenDeclarations(DARK_TOKENS)}
  --shadow: 0 6px 20px -6px rgba(0,0,0,0.55), 0 2px 6px -2px rgba(0,0,0,0.35);
}
@media (prefers-color-scheme: light) {
  :host(:not([data-theme])) {
    color-scheme: light;
${tokenDeclarations(LIGHT_TOKENS, "    ")}
    --shadow: 0 6px 20px -8px rgba(30,30,40,0.22), 0 2px 6px -2px rgba(30,30,40,0.10);
  }
}
:host([data-theme="light"]) {
  color-scheme: light;
${tokenDeclarations(LIGHT_TOKENS)}
  --shadow: 0 6px 20px -8px rgba(30,30,40,0.22), 0 2px 6px -2px rgba(30,30,40,0.10);
}
:host([data-theme="dark"]) {
  color-scheme: dark;
${tokenDeclarations(DARK_TOKENS)}
  --shadow: 0 6px 20px -6px rgba(0,0,0,0.55), 0 2px 6px -2px rgba(0,0,0,0.35);
}
* { box-sizing: border-box; }
.root {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  font: 13px/1.45 var(--font-ui);
  color: var(--fg);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}
button:disabled { cursor: default; opacity: 0.6; }
button:focus-visible, a:focus-visible {
  outline: 2px solid var(--accent-solid);
  outline-offset: 2px;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow);
  font-weight: 600;
}
.pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.pill .dot[data-tone="accent"] { background: var(--accent-solid); }
.pill .dot[data-tone="success"] { background: var(--success); }
.pill .dot[data-tone="warning"] { background: var(--warning); }
.pill .status { font-weight: 400; color: var(--muted); }
.pill svg { width: 12px; height: 12px; color: var(--muted); }
.card {
  width: 300px;
  max-width: calc(100vw - 32px);
  /* Never taller than the window: the body scrolls instead. */
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.card header .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .body { display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow-y: auto; min-height: 0; }
.card footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--subtle);
}
.card footer a { color: var(--muted); text-decoration: none; font-size: 12px; }
.card footer a:hover { color: var(--fg); }
.text { margin: 0; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; }
.stack { display: flex; flex-direction: column; gap: 6px; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
}
.btn:hover:not(:disabled) { background: var(--subtle); }
.btn-primary { background: var(--accent-solid); border-color: var(--accent-solid); color: var(--accent-contrast); font-weight: 600; }
.btn-primary:hover:not(:disabled) { background: var(--accent-solid); filter: brightness(1.05); }
.btn-ghost { border-color: transparent; background: transparent; color: var(--muted); }
.btn-ghost:hover:not(:disabled) { color: var(--fg); background: var(--subtle); }
.btn-danger { color: var(--danger); }
.btn-icon { min-height: 28px; width: 28px; padding: 0; border-color: transparent; background: transparent; color: var(--muted); }
.btn-icon svg { width: 14px; height: 14px; }
.btn-block { width: 100%; }
.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--accent-soft);
  color: var(--accent);
}
.notice {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--subtle);
  font-size: 12px;
}
.notice[data-tone="warning"] { background: var(--warning-soft); color: var(--warning); }
.notice[data-tone="danger"] { color: var(--danger); }
.ratings { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.rating {
  --grade: var(--muted);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  /* The grade's color marks the leading edge; the label names it, so color is never the only cue. */
  border-left: 3px solid var(--grade);
  background: var(--surface);
  text-align: left;
}
.rating:hover:not(:disabled) { background: var(--subtle); border-color: var(--grade); }
.rating .label { font-weight: 600; color: var(--grade); }
.rating[data-grade="1"] { --grade: var(--hard); }
.rating[data-grade="2"] { --grade: var(--medium); }
.rating[data-grade="3"] { --grade: var(--success); }
.rating[data-grade="4"] { --grade: var(--easy); }
.rating .hint { font-size: 11px; color: var(--muted); }
select {
  font: inherit;
  color: inherit;
  min-height: 32px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
}
select:focus-visible { outline: 2px solid var(--accent-solid); outline-offset: 2px; }
.analysis { border-top: 1px solid var(--border); padding-top: 10px; }
.finding { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 8px; background: var(--subtle); }
.status-line { display: inline-flex; align-items: center; gap: 6px; }
.evidence { gap: 2px; }
.text[data-tone="warning"] { color: var(--warning); }
.spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-right-color: transparent;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .spinner { animation-duration: 2.4s; }
}
`;
