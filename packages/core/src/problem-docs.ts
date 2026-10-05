/**
 * The two markdown documents each problem keeps (docs/coach-practice.md):
 *
 * - Notes: free-form understanding. The Coach targets `##` sections
 *   (Approach, Key insight, Pitfalls, Complexity, My attempts) so its edits
 *   stay small.
 * - Cards: each `##` heading is a prompt; the text under it, up to the next
 *   `##`, is the answer. Text before the first heading is ignored.
 *
 * Pure functions, shared by the server, the extension, and the web app.
 */

export const NOTES_DOC_MAX_CHARS = 50_000;
export const CARDS_DOC_MAX_CHARS = 20_000;
export const CARDS_DOC_MAX_CARDS = 30;
export const CARD_PROMPT_MAX_CHARS = 300;
export const DOC_SECTION_MAX_CHARS = 60;

/** Sections the Coach writes into Notes, in the order it creates them. */
export const NOTES_SECTIONS = ["Approach", "Key insight", "Pitfalls", "Complexity", "My attempts"] as const;

export type DocCard = { key: string; prompt: string; answer: string };

export type CardsDocIssue =
  | { kind: "empty_answer"; prompt: string }
  | { kind: "duplicate_prompt"; prompt: string }
  | { kind: "too_many_cards"; limit: number }
  | { kind: "too_long"; limit: number };

export type CardsEdit =
  | { op: "add_card"; prompt: string; answer: string }
  | { op: "update_card"; key: string; prompt?: string; answer?: string }
  | { op: "remove_card"; key: string };

export type NotesEdit =
  | { op: "append_section"; section: string; markdown: string }
  | { op: "replace_section"; section: string; markdown: string };

export type DocEditError =
  | "card_not_found"
  | "duplicate_prompt"
  | "invalid_prompt"
  | "empty_answer"
  | "invalid_section"
  | "too_many_cards"
  | "too_long";

export type DocEditResult = { ok: true; markdown: string } | { ok: false; error: DocEditError };

/* ── shared: split a doc into `##` blocks, ignoring headings inside code ── */

type Block = { heading: string; body: string[] };
type Split = { preamble: string[]; blocks: Block[] };

const H2 = /^##(?!#)\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

function splitH2(markdown: string | null | undefined): Split {
  const lines = (markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const preamble: string[] = [];
  const blocks: Block[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) fence = fence ? (fenceMatch[1] === fence ? null : fence) : fenceMatch[1]!;
    const heading = !fence && !fenceMatch ? line.match(H2) : null;
    if (heading) {
      blocks.push({ heading: heading[1]!.trim(), body: [] });
    } else if (blocks.length > 0) {
      blocks.at(-1)!.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, blocks };
}

function joinH2({ preamble, blocks }: Split): string {
  const parts: string[] = [];
  const head = trimBlankLines(preamble).join("\n");
  if (head) parts.push(head);
  for (const block of blocks) {
    const body = trimBlankLines(block.body).join("\n");
    parts.push(body ? `## ${block.heading}\n${body}` : `## ${block.heading}`);
  }
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]!.trim()) start++;
  while (end > start && !lines[end - 1]!.trim()) end--;
  return lines.slice(start, end);
}

/* ── Cards ── */

export function normalizeCardPrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Stable id for a card: a hash of its normalized prompt. Editing the answer
 *  keeps the key; rewording the prompt makes it a new card. */
export function cardKey(prompt: string): string {
  // FNV-1a, 32-bit, twice with different offsets for 64 bits of key space.
  const text = normalizeCardPrompt(prompt);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x01000193);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export function parseCards(markdown: string | null | undefined): { cards: DocCard[]; issues: CardsDocIssue[] } {
  const issues: CardsDocIssue[] = [];
  const text = markdown ?? "";
  if (text.length > CARDS_DOC_MAX_CHARS) issues.push({ kind: "too_long", limit: CARDS_DOC_MAX_CHARS });
  const cards: DocCard[] = [];
  const seen = new Set<string>();
  for (const block of splitH2(text).blocks) {
    if (!block.heading) continue;
    const answer = trimBlankLines(block.body).join("\n");
    const key = cardKey(block.heading);
    if (seen.has(key)) {
      issues.push({ kind: "duplicate_prompt", prompt: block.heading });
      continue;
    }
    seen.add(key);
    if (!answer) {
      issues.push({ kind: "empty_answer", prompt: block.heading });
      continue;
    }
    cards.push({ key, prompt: block.heading, answer });
  }
  if (cards.length > CARDS_DOC_MAX_CARDS) {
    issues.push({ kind: "too_many_cards", limit: CARDS_DOC_MAX_CARDS });
    cards.length = CARDS_DOC_MAX_CARDS;
  }
  return { cards, issues };
}

/** One card per `##` block, in order. Used to convert legacy card rows. */
export function serializeCards(cards: { prompt: string; answer: string }[]): string {
  return joinH2({
    preamble: [],
    blocks: cards.map((card) => ({ heading: cleanPrompt(card.prompt), body: card.answer.trim().split("\n") })),
  });
}

function cleanPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

function validPrompt(prompt: string): boolean {
  return prompt.length > 0 && prompt.length <= CARD_PROMPT_MAX_CHARS;
}

export function applyCardsEdit(markdown: string | null | undefined, edit: CardsEdit): DocEditResult {
  const split = splitH2(markdown);
  const indexOf = (key: string) => split.blocks.findIndex((block) => cardKey(block.heading) === key);

  if (edit.op === "add_card") {
    const prompt = cleanPrompt(edit.prompt);
    const answer = edit.answer.trim();
    if (!validPrompt(prompt)) return { ok: false, error: "invalid_prompt" };
    if (!answer) return { ok: false, error: "empty_answer" };
    if (indexOf(cardKey(prompt)) >= 0) return { ok: false, error: "duplicate_prompt" };
    if (parseCards(markdown).cards.length >= CARDS_DOC_MAX_CARDS) return { ok: false, error: "too_many_cards" };
    split.blocks.push({ heading: prompt, body: answer.split("\n") });
  } else if (edit.op === "update_card") {
    const index = indexOf(edit.key);
    if (index < 0) return { ok: false, error: "card_not_found" };
    const block = split.blocks[index]!;
    if (edit.prompt !== undefined) {
      const prompt = cleanPrompt(edit.prompt);
      if (!validPrompt(prompt)) return { ok: false, error: "invalid_prompt" };
      const clash = indexOf(cardKey(prompt));
      if (clash >= 0 && clash !== index) return { ok: false, error: "duplicate_prompt" };
      block.heading = prompt;
    }
    if (edit.answer !== undefined) {
      const answer = edit.answer.trim();
      if (!answer) return { ok: false, error: "empty_answer" };
      block.body = answer.split("\n");
    }
  } else {
    const index = indexOf(edit.key);
    if (index < 0) return { ok: false, error: "card_not_found" };
    split.blocks.splice(index, 1);
  }

  const next = joinH2(split);
  if (next.length > CARDS_DOC_MAX_CHARS) return { ok: false, error: "too_long" };
  return { ok: true, markdown: next };
}

/* ── Notes ── */

export function applyNotesEdit(markdown: string | null | undefined, edit: NotesEdit): DocEditResult {
  const section = cleanPrompt(edit.section);
  if (!section || section.length > DOC_SECTION_MAX_CHARS) return { ok: false, error: "invalid_section" };
  const content = trimBlankLines(edit.markdown.replace(/\r\n?/g, "\n").split("\n"));
  const split = splitH2(markdown);
  const block = split.blocks.find((candidate) => candidate.heading.toLowerCase() === section.toLowerCase());

  if (!block) {
    split.blocks.push({ heading: section, body: content });
  } else if (edit.op === "replace_section") {
    block.body = content;
  } else {
    const existing = trimBlankLines(block.body);
    block.body = existing.length ? [...existing, "", ...content] : content;
  }

  const next = joinH2(split);
  if (next.length > NOTES_DOC_MAX_CHARS) return { ok: false, error: "too_long" };
  return { ok: true, markdown: next };
}

/** The `##` section headings in a Notes doc, for citations. */
export function notesSections(markdown: string | null | undefined): string[] {
  return splitH2(markdown).blocks.map((block) => block.heading).filter(Boolean);
}
