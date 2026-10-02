/**
 * The LeetCode-native palette shared by the panel, the popup, and the web app:
 * LeetCode's dark and light surfaces, its orange (#ffa116) as the solid accent
 * for fills, and a text-safe accent (darker in light mode, where #ffa116 on
 * white fails WCAG AA). Every text color meets 4.5:1 on its surface.
 *
 * The panel builds its CSS from this module. `popup/popup.css` and the web's
 * `globals.css` repeat the values; `theme-tokens.test.ts` keeps all three equal.
 */
export type ThemeTokens = Record<
  | "bg" | "surface" | "subtle" | "fg" | "muted" | "border"
  | "accent" | "accent-solid" | "accent-contrast" | "accent-soft"
  | "success" | "warning" | "warning-soft" | "danger" | "danger-contrast"
  | "easy" | "medium" | "hard",
  string
>;

export const DARK_TOKENS: ThemeTokens = {
  bg: "#1a1a1a",
  surface: "#262626",
  subtle: "#303030",
  fg: "#eff1f6",
  muted: "#a0a1a6",
  border: "#3d3d3d",
  accent: "#ffa116",
  "accent-solid": "#ffa116",
  "accent-contrast": "#1a1a1a",
  "accent-soft": "#3d2e14",
  success: "#2cbb5d",
  warning: "#ffb800",
  "warning-soft": "#3a2f10",
  danger: "#f8615c",
  "danger-contrast": "#1a1a1a",
  easy: "#00b8a3",
  medium: "#ffc01e",
  hard: "#ff5a76",
};

export const LIGHT_TOKENS: ThemeTokens = {
  bg: "#f7f8fa",
  surface: "#ffffff",
  subtle: "#f2f3f5",
  fg: "#262626",
  muted: "#5f6268",
  border: "#e3e5e8",
  accent: "#a85800",
  "accent-solid": "#ffa116",
  "accent-contrast": "#1a1a1a",
  "accent-soft": "#fff4e0",
  success: "#15803d",
  warning: "#9a5c00",
  "warning-soft": "#fff6e0",
  danger: "#d0312d",
  "danger-contrast": "#ffffff",
  easy: "#00796b",
  medium: "#8a5d00",
  hard: "#d91a4a",
};

/** `--name: value;` declarations, one per line. */
export function tokenDeclarations(tokens: ThemeTokens, indent = "  ") {
  return Object.entries(tokens)
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join("\n");
}
