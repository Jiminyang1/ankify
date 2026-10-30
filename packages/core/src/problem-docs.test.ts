import { describe, expect, it } from "vitest";
import {
  CARDS_DOC_MAX_CARDS,
  applyNotesEdit,
  cardKey,
  isSignalPoint,
  notesSections,
  parseCards,
  parseSolutions,
  serializeCards,
  serializeSolutions,
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

const SOLUTIONS = `Approaches I know for this one.

## lo/hi range (mine)
- lo/hi track the fewest and most unmatched \`(\`
- \`*\` widens both ends by 1,
  covering all three meanings at once
- hi < 0 fails early; at the end, lo must be 0
Complexity: O(n) time, O(1) space

## DP
- dp[i][j]: can s[i..j] be valid
- Complexity: O(n^3) time, O(n^2) space

## 栈（我的）
- 两个栈分别存 ( 和 * 的下标
复杂度：O(n)

## Empty one
Some prose without bullets.
`;

describe("Solutions doc", () => {
  it("parses approaches, their points, and their cost", () => {
    const { approaches, issues } = parseSolutions(SOLUTIONS);
    expect(approaches).toEqual([
      {
        id: "a1",
        name: "lo/hi range",
        mine: true,
        points: [
          "lo/hi track the fewest and most unmatched `(`",
          "`*` widens both ends by 1, covering all three meanings at once",
          "hi < 0 fails early; at the end, lo must be 0",
        ],
        complexity: "O(n) time, O(1) space",
      },
      { id: "a2", name: "DP", mine: false, points: ["dp[i][j]: can s[i..j] be valid"], complexity: "O(n^3) time, O(n^2) space" },
      { id: "a3", name: "栈", mine: true, points: ["两个栈分别存 ( 和 * 的下标"], complexity: "O(n)" },
    ]);
    expect(issues).toEqual([{ kind: "no_points", approach: "Empty one" }]);
  });

  it("round-trips through serializeSolutions", () => {
    const { approaches } = parseSolutions(SOLUTIONS);
    const markdown = serializeSolutions(approaches);
    expect(markdown.startsWith("## lo/hi range (mine)\n- lo/hi track")).toBe(true);
    expect(parseSolutions(markdown).approaches).toEqual(approaches);
    expect(serializeSolutions(approaches.slice(2), "zh")).toBe("## 栈 (我的)\n- 两个栈分别存 ( 和 * 的下标\n复杂度: O(n)\n");
  });

  it("writes the signal as the first point, labeled in the doc's language", () => {
    const approach = {
      name: "Variable-size sliding window",
      mine: true,
      signal: "contiguous subarray, all values positive, sum ≥ target",
      points: ["Shrink from the left while the sum still meets the target"],
      complexity: "O(n) time, O(1) space",
    };
    const markdown = serializeSolutions([approach]);
    expect(markdown).toBe(
      "## Variable-size sliding window (mine)\n- Signal: contiguous subarray, all values positive, sum ≥ target\n- Shrink from the left while the sum still meets the target\nComplexity: O(n) time, O(1) space\n",
    );
    // Parsing needs nothing new: the signal is the approach's first point.
    expect(parseSolutions(markdown).approaches[0]!.points).toEqual([
      "Signal: contiguous subarray, all values positive, sum ≥ target",
      "Shrink from the left while the sum still meets the target",
    ]);
    // A label the model already wrote isn't doubled; zh gets its own label.
    expect(serializeSolutions([{ ...approach, signal: "信号：连续子数组，元素全为正" }], "zh")).toContain(
      "\n- 题眼：连续子数组，元素全为正\n",
    );
    expect(serializeSolutions([{ ...approach, signal: "  " }])).not.toContain("Signal");
  });

  it("recognizes a signal point in either language", () => {
    expect(isSignalPoint("Signal: contiguous subarray")).toBe(true);
    expect(isSignalPoint(" signal：sorted input")).toBe(true);
    expect(isSignalPoint("题眼：连续子数组")).toBe(true);
    expect(isSignalPoint("信号: 有序数组")).toBe(true);
    expect(isSignalPoint("The signal is lost when the window shrinks")).toBe(false);
    expect(isSignalPoint("Complexity: O(n) time")).toBe(false);
  });
});
