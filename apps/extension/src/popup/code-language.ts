export type CodeLanguage =
  | "bash"
  | "c"
  | "cpp"
  | "csharp"
  | "dart"
  | "go"
  | "java"
  | "javascript"
  | "kotlin"
  | "php"
  | "python"
  | "ruby"
  | "rust"
  | "scala"
  | "sql"
  | "swift"
  | "typescript";

/** A fence's language, including the names LeetCode uses for its editors. */
const LANGUAGES: Record<string, CodeLanguage> = {
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  c: "c",
  "c++": "cpp",
  cpp: "cpp",
  "c#": "csharp",
  cs: "csharp",
  csharp: "csharp",
  dart: "dart",
  go: "go",
  golang: "go",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  kotlin: "kotlin",
  kt: "kotlin",
  mssql: "sql",
  mysql: "sql",
  oraclesql: "sql",
  pandas: "python",
  php: "php",
  postgresql: "sql",
  py: "python",
  python: "python",
  python3: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  scala: "scala",
  sql: "sql",
  swift: "swift",
  ts: "typescript",
  typescript: "typescript",
};

export function resolveCodeLanguage(language: string | null | undefined): CodeLanguage | null {
  if (!language) return null;
  const key = language.trim().toLowerCase();
  return Object.hasOwn(LANGUAGES, key) ? LANGUAGES[key]! : null;
}

export type TextPart = { kind: "text"; text: string } | { kind: "code"; code: string; language: string | null };

/** Splits a user's message around its fenced code blocks. Only fences count, so
 *  the rest of the message stays exactly as typed. An unclosed fence runs to the
 *  end of the message. */
export function splitCodeFences(message: string): TextPart[] {
  const parts: TextPart[] = [];
  const fence = /(^|\n)```([^\n`]*)\n([\s\S]*?)(?:\n```[ \t]*(?=\n|$)|$)/g;
  let end = 0;
  for (const match of message.matchAll(fence)) {
    const text = message.slice(end, match.index);
    if (text) parts.push({ kind: "text", text });
    parts.push({ kind: "code", code: match[3]!, language: match[2]!.trim() || null });
    end = match.index + match[0].length;
  }
  const rest = message.slice(end).replace(/^\n/, "");
  if (rest) parts.push({ kind: "text", text: rest });
  return parts;
}
