import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DARK_TOKENS, LIGHT_TOKENS, type ThemeTokens } from "./theme-tokens";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

/** The `--name: value` declarations of the first block after `anchor`. */
function block(css: string, anchor: string) {
  const start = css.indexOf(anchor);
  if (start < 0) throw new Error(`no block after ${anchor}`);
  const open = css.indexOf("{", start + anchor.length - 1);
  const body = css.slice(open, css.indexOf("}", open));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
}

const hex = (value: string) => value.toLowerCase();
const rgb = (value: string) => {
  const v = value.replace("#", "");
  return [0, 2, 4].map((index) => parseInt(v.slice(index, index + 2), 16)).join(" ");
};
const pick = (declared: Record<string, string>, tokens: ThemeTokens) => Object.fromEntries(Object.keys(tokens).map((name) => [name, declared[name]]));

describe("one LeetCode-native palette everywhere", () => {
  const popup = read("../popup/popup.css");
  const web = read("../../../web/src/app/globals.css");

  it("repeats the shared tokens in all four popup theme blocks", () => {
    const asHex = (tokens: ThemeTokens) => Object.fromEntries(Object.entries(tokens).map(([name, value]) => [name, hex(value)]));
    expect(pick(block(popup, "/* ── Dark theme (default) ── */"), DARK_TOKENS)).toEqual(asHex(DARK_TOKENS));
    expect(pick(block(popup, "@media (prefers-color-scheme: light) {\n  :root"), LIGHT_TOKENS)).toEqual(asHex(LIGHT_TOKENS));
    expect(pick(block(popup, '[data-theme="dark"] {'), DARK_TOKENS)).toEqual(asHex(DARK_TOKENS));
    expect(pick(block(popup, '[data-theme="light"] {'), LIGHT_TOKENS)).toEqual(asHex(LIGHT_TOKENS));
  });

  it("repeats the shared tokens in the web app's three theme blocks", () => {
    const asRgb = (tokens: ThemeTokens) => Object.fromEntries(Object.entries(tokens).map(([name, value]) => [name, rgb(value)]));
    expect(pick(block(web, "/* ── Dark theme (default) ── */"), DARK_TOKENS)).toEqual(asRgb(DARK_TOKENS));
    expect(pick(block(web, '[data-theme="light"] {'), LIGHT_TOKENS)).toEqual(asRgb(LIGHT_TOKENS));
    expect(pick(block(web, ":root:not([data-theme]) {"), LIGHT_TOKENS)).toEqual(asRgb(LIGHT_TOKENS));
  });
});

describe("the panel follows LeetCode's theme", () => {
  it("reads LeetCode's class, data-theme, or color-scheme, and nothing otherwise", async () => {
    const { leetcodeTheme } = await import("../content/panel");
    const root = (classes: string[], dataset: Record<string, string> = {}, scheme = "normal") => {
      (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({ colorScheme: scheme });
      return { classList: { contains: (name: string) => classes.includes(name) }, dataset } as unknown as HTMLElement;
    };
    expect(leetcodeTheme(root(["dark"]))).toBe("dark");
    expect(leetcodeTheme(root(["light"]))).toBe("light");
    expect(leetcodeTheme(root([], { theme: "dark" }))).toBe("dark");
    expect(leetcodeTheme(root([], {}, "light"))).toBe("light");
    expect(leetcodeTheme(root([], {}, "light dark"))).toBeNull();
    expect(leetcodeTheme(root([]))).toBeNull();
  });
});
