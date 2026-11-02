import { Fragment, useEffect, useMemo, useState } from "react";
import type { HighlighterCore } from "shiki/core";
import { resolveCodeLanguage, type CodeLanguage } from "./code-language";

/**
 * Syntax highlighting for code in the side panel. The manifest's CSP allows
 * neither eval nor wasm, so Shiki runs on its JavaScript regex engine. The
 * highlighter and each language load on first use, and code shows plain until
 * then or if anything fails.
 */

const GRAMMARS: Record<CodeLanguage, () => Promise<{ default: Parameters<HighlighterCore["loadLanguage"]>[0] }>> = {
  bash: () => import("@shikijs/langs/bash"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  dart: () => import("@shikijs/langs/dart"),
  go: () => import("@shikijs/langs/go"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  php: () => import("@shikijs/langs/php"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scala: () => import("@shikijs/langs/scala"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  typescript: () => import("@shikijs/langs/typescript"),
};

const THEMES = { light: "github-light", dark: "github-dark" };

let highlighter: Promise<HighlighterCore> | undefined;
const loaded = new Map<CodeLanguage, HighlighterCore>();
let loggedFailure = false;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("@shikijs/themes/github-light"),
      import("@shikijs/themes/github-dark"),
    ]);
    return createHighlighterCore({
      themes: [light.default, dark.default],
      langs: [],
      // Forgiving: a grammar rule the JavaScript engine can't run is skipped
      // instead of failing the whole language.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  return highlighter;
}

async function loadLanguage(language: CodeLanguage): Promise<HighlighterCore> {
  const core = await getHighlighter();
  await core.loadLanguage((await GRAMMARS[language]()).default);
  loaded.set(language, core);
  return core;
}

function logFailureOnce(error: unknown) {
  if (loggedFailure) return;
  loggedFailure = true;
  console.error("[ankify] syntax highlighting failed", error);
}

export function HighlightedCode({ code, language }: { code: string; language: string | null }) {
  const lang = resolveCodeLanguage(language);
  const [core, setCore] = useState<HighlighterCore | null>(() => (lang ? (loaded.get(lang) ?? null) : null));

  useEffect(() => {
    if (!lang) return;
    let cancelled = false;
    loadLanguage(lang)
      .then((ready) => {
        if (!cancelled) setCore(ready);
      })
      .catch(logFailureOnce);
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const lines = useMemo(() => {
    if (!core || !lang || !core.getLoadedLanguages().includes(lang)) return null;
    try {
      return core.codeToTokens(code, { lang, themes: THEMES, defaultColor: "light-dark()" }).tokens;
    } catch (error) {
      logFailureOnce(error);
      return null;
    }
  }, [code, core, lang]);

  if (!lines) return <code>{code}</code>;
  return (
    <code>
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 && "\n"}
          {line.map((token, tokenIndex) => (
            <span key={tokenIndex} style={{ color: token.htmlStyle?.color }}>
              {token.content}
            </span>
          ))}
        </Fragment>
      ))}
    </code>
  );
}
