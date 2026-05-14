"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "bash",
  c: "c",
  "c#": "csharp",
  csharp: "csharp",
  "c++": "cpp",
  cpp: "cpp",
  dart: "dart",
  elixir: "elixir",
  erlang: "erlang",
  go: "go",
  golang: "go",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  kotlin: "kotlin",
  "ms sql server": "sql",
  mysql: "sql",
  oracle: "sql",
  pandas: "python",
  php: "php",
  python: "python",
  python3: "python",
  racket: "racket",
  ruby: "ruby",
  rust: "rust",
  scala: "scala",
  swift: "swift",
  typescript: "typescript",
  ts: "typescript",
};

function normalizeLanguage(language: string | null | undefined) {
  if (!language) return "text";
  const key = language.trim().toLowerCase().replace(/\s+/g, " ");
  return LANGUAGE_ALIASES[key] ?? key.replace(/[^a-z0-9+#-]/g, "");
}

export function HighlightedCode({
  code,
  language,
  className,
}: {
  code: string;
  language?: string | null;
  className?: string;
}) {
  const lang = useMemo(() => normalizeLanguage(language), [language]);
  const cacheKey = `${lang}\0${code}`;
  const [highlight, setHighlight] = useState<{ key: string; html: string | null }>({ key: "", html: null });

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      try {
        const { codeToHtml } = await import("shiki/bundle/web");
        const rendered = await codeToHtml(code, {
          lang,
          themes: {
            light: "github-light",
            dark: "github-dark",
          },
          defaultColor: "light-dark()",
        });
        if (!cancelled) setHighlight({ key: cacheKey, html: rendered });
      } catch {
        if (!cancelled) setHighlight({ key: cacheKey, html: null });
      }
    }

    void highlight();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, lang]);

  const html = highlight.key === cacheKey ? highlight.html : null;

  return (
    <div className={cn("highlighted-code overflow-auto", className)}>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="m-0 whitespace-pre px-4 py-3 font-mono text-xs leading-6 text-fg">
          {code}
        </pre>
      )}
    </div>
  );
}
