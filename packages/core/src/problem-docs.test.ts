import { describe, expect, it } from "vitest";
import {
  CARDS_DOC_MAX_CARDS,
  applyCardsEdit,
  applyNotesEdit,
  cardKey,
  notesSections,
  parseCards,
  serializeCards,
} from "./problem-docs";

const CARDS = `Things I keep forgetting.

## Why check the map before inserting?
Inserting first lets a number pair with itself.

## Time and space?
O(n) and O(n).

\`\`\`python
## not a card: a comment inside code
\`\`\`
`;

describe("parseCards", () => {
  it("reads ## prompts and answers, ignoring the preamble and code", () => {
    const { cards, issues } = parseCards(CARDS);
    expect(cards.map((card) => card.prompt)).toEqual(["Why check the map before inserting?", "Time and space?"]);
    expect(cards[1]!.answer).toBe("O(n) and O(n).\n\n```python\n## not a card: a comment inside code\n```");
    expect(issues).toEqual([]);
  });

  it("reports empty answers and duplicate prompts instead of guessing", () => {
    const { cards, issues } = parseCards("## A\n\n## a \nsecond\n## B\nanswer");
    expect(cards.map((card) => card.prompt)).toEqual(["B"]);
    expect(issues).toEqual([
      { kind: "empty_answer", prompt: "A" },
      { kind: "duplicate_prompt", prompt: "a" },
    ]);
  });

  it("keys cards by normalized prompt", () => {
    expect(cardKey("  Time and   SPACE? ")).toBe(cardKey("time and space?"));
    expect(cardKey("time and space?")).not.toBe(cardKey("time and space"));
    expect(cardKey("x")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("caps the number of cards", () => {
    const md = serializeCards(Array.from({ length: CARDS_DOC_MAX_CARDS + 2 }, (_, i) => ({ prompt: `Q${i}`, answer: "A" })));
    const { cards, issues } = parseCards(md);
    expect(cards).toHaveLength(CARDS_DOC_MAX_CARDS);
    expect(issues).toContainEqual({ kind: "too_many_cards", limit: CARDS_DOC_MAX_CARDS });
  });
});

describe("applyCardsEdit", () => {
  const key = cardKey("Time and space?");

  it("adds, updates, and removes cards without touching the rest", () => {
    const added = applyCardsEdit(CARDS, { op: "add_card", prompt: "Edge case?\n", answer: "Empty array." });
    expect(added.ok && parseCards(added.markdown).cards.map((card) => card.prompt)).toEqual([
      "Why check the map before inserting?",
      "Time and space?",
      "Edge case?",
    ]);
    expect(added.ok && added.markdown.startsWith("Things I keep forgetting.")).toBe(true);

    const updated = applyCardsEdit(CARDS, { op: "update_card", key, answer: "O(n) time, O(n) space." });
    expect(updated.ok && parseCards(updated.markdown).cards[1]).toEqual({
      key,
      prompt: "Time and space?",
      answer: "O(n) time, O(n) space.",
    });

    const removed = applyCardsEdit(CARDS, { op: "remove_card", key });
    expect(removed.ok && parseCards(removed.markdown).cards.map((card) => card.prompt)).toEqual([
      "Why check the map before inserting?",
    ]);
  });

  it("rejects duplicates, unknown keys, and empty content", () => {
    expect(applyCardsEdit(CARDS, { op: "add_card", prompt: "time and SPACE?", answer: "x" })).toEqual({
      ok: false,
      error: "duplicate_prompt",
    });
    expect(applyCardsEdit(CARDS, { op: "remove_card", key: "0000000000000000" })).toEqual({
      ok: false,
      error: "card_not_found",
    });
    expect(applyCardsEdit(CARDS, { op: "add_card", prompt: "New?", answer: "  " })).toEqual({
      ok: false,
      error: "empty_answer",
    });
    expect(applyCardsEdit(CARDS, { op: "update_card", key, prompt: "Why check the map before inserting?" })).toEqual({
      ok: false,
      error: "duplicate_prompt",
    });
  });
});

describe("applyNotesEdit", () => {
  const NOTES = "My own words first.\n\n## Approach\nOne pass with a hash map.\n";

  it("appends to an existing section and creates missing ones at the end", () => {
    const appended = applyNotesEdit(NOTES, { op: "append_section", section: "approach", markdown: "Check before insert." });
    expect(appended).toEqual({
      ok: true,
      markdown: "My own words first.\n\n## Approach\nOne pass with a hash map.\n\nCheck before insert.\n",
    });
    const created = applyNotesEdit(NOTES, { op: "append_section", section: "Pitfalls", markdown: "- pairing with itself" });
    expect(created.ok && notesSections(created.markdown)).toEqual(["Approach", "Pitfalls"]);
  });

  it("replaces a section's content and keeps its heading", () => {
    const replaced = applyNotesEdit(NOTES, { op: "replace_section", section: "Approach", markdown: "Sort + two pointers." });
    expect(replaced).toEqual({ ok: true, markdown: "My own words first.\n\n## Approach\nSort + two pointers.\n" });
  });

  it("rejects an empty or overlong section name", () => {
    expect(applyNotesEdit(NOTES, { op: "append_section", section: " ", markdown: "x" })).toEqual({
      ok: false,
      error: "invalid_section",
    });
  });
});
