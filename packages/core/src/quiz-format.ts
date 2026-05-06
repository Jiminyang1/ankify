const IDENTIFIERS = [
  "amount",
  "coins",
  "dp",
  "memo",
  "rem",
  "target",
  "state",
  "index",
  "len",
  "n",
  "m",
  "i",
  "j",
  "k",
] as const;

const IDENTIFIER_PATTERN = IDENTIFIERS.join("|");

export function formatQuizMarkdown(value: string): string {
  const placeholders: string[] = [];
  const protect = (text: string) => {
    const token = `\uE000${placeholders.length}\uE001`;
    placeholders.push(text);
    return token;
  };

  let text = value.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => protect(match));

  text = text.replace(/\b(?:O|Θ|Ω)\((?:[^()]|\([^()]*\))*\)/g, (match) => protect(`\`${match}\``));
  text = text.replace(/\b[A-Za-z_][\w]*\[[^\]\n]+\]/g, (match) => protect(`\`${match}\``));
  text = text.replace(/\blen\([A-Za-z_][\w]*\)/g, (match) => protect(`\`${match}\``));
  text = text.replace(
    new RegExp(`\\b(?:${IDENTIFIER_PATTERN}|\\d+)\\s*(?:[+\\-*/]\\s*(?:${IDENTIFIER_PATTERN}|\\d+))+\\b`, "g"),
    (match) => protect(`\`${match.replace(/\s+/g, " ")}\``),
  );
  text = text.replace(new RegExp(`\\b(?:${IDENTIFIER_PATTERN})\\b`, "g"), (match) => protect(`\`${match}\``));

  return text.replace(/\uE000(\d+)\uE001/g, (_, index: string) => placeholders[Number(index)] ?? "");
}
