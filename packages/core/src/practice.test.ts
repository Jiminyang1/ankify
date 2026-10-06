import { describe, expect, it } from "vitest";
import {
  questionOverlap,
  selectPracticeCards,
  suggestPracticeRating,
  validateCheckItems,
  type CheckDraftItem,
  type CheckRules,
} from "./practice";
import { cardKey } from "./problem-docs";

const card = (prompt: string) => ({ key: cardKey(prompt), prompt, answer: "a" });

describe("selectPracticeCards", () => {
  const a = card("A?");
  const b = card("B?");
  const c = card("C?");
  const d = card("D?");

  it("puts last-missed cards first, then never-shown, then the oldest", () => {
    const picked = selectPracticeCards([a, b, c, d], {
      [a.key]: { lastShownAt: "2026-10-01T00:00:00Z", lastResult: "got_it", missCount: 0 },
      [b.key]: { lastShownAt: "2026-10-03T00:00:00Z", lastResult: "missed", missCount: 1 },
      [d.key]: { lastShownAt: "2026-09-01T00:00:00Z", lastResult: "got_it", missCount: 0 },
    });
    expect(picked.map((x) => x.prompt)).toEqual(["B?", "C?", "D?"]);
  });

  it("keeps doc order among never-shown cards", () => {
    expect(selectPracticeCards([a, b, c, d], {}).map((x) => x.prompt)).toEqual(["A?", "B?", "C?"]);
  });
});

describe("suggestPracticeRating", () => {
  it("maps the score to a rating, with Easy only for a perfect longer session", () => {
    expect(suggestPracticeRating(1, 6)).toBe(1);
    expect(suggestPracticeRating(3, 6)).toBe(2);
    expect(suggestPracticeRating(5, 6)).toBe(3);
    expect(suggestPracticeRating(6, 6)).toBe(4);
    expect(suggestPracticeRating(3, 3)).toBe(3);
  });
});

describe("validateCheckItems", () => {
  const rules: CheckRules = {
    notesSections: ["Approach", "Pitfalls"],
    cardKeys: [cardKey("Why check the map before inserting?")],
    submissionIds: ["sub_1"],
    selectedCardPrompts: ["Why check the map before inserting?"],
    recentQuestions: ["What does the hash map store for each index?"],
    requireMistakeReview: true,
  };
  const item = (overrides: Partial<CheckDraftItem>): CheckDraftItem => ({
    question: "Which loop invariant keeps the scan correct?",
    choices: ["A", "B", "C", "D"],
    correctAnswer: "A",
    scope: "invariant",
    sourceKind: "statement",
    sourceRef: "",
    ...overrides,
  });
  const valid = [
    item({}),
    item({ question: "What is the time complexity of one pass with lookups?", scope: "complexity", sourceKind: "notes", sourceRef: "approach" }),
    item({ question: "Your attempt returned [0,0] on [3,2,4]. What caused it?", scope: "mistake_review", sourceKind: "submission", sourceRef: "sub_1" }),
  ];

  it("accepts a grounded, varied batch", () => {
    expect(validateCheckItems(valid, rules)).toEqual([]);
  });

  it("rejects a citation that doesn't resolve", () => {
    const bad = [valid[0]!, valid[1]!, { ...valid[2]!, sourceRef: "sub_404" }];
    expect(validateCheckItems(bad, rules)).toEqual([{ rule: "citation", item: 2 }]);
  });

  it("rejects too few angles, missing complexity, and restating a card", () => {
    const bad = [
      item({ question: "Why check the map before inserting each number?" }),
      item({ question: "Which index pairs are valid answers here?", scope: "invariant" }),
      item({ question: "Your attempt returned [0,0] on [3,2,4]. What caused it?", scope: "mistake_review", sourceKind: "submission", sourceRef: "sub_1" }),
    ];
    const rules2 = { ...rules, selectedCardPrompts: rules.selectedCardPrompts };
    expect(validateCheckItems(bad, rules2)).toEqual(
      expect.arrayContaining([{ rule: "restates_card", item: 0 }, { rule: "scopes", minimum: 3 }, { rule: "complexity" }]),
    );
  });

  it("counts a complexity card shown in this session as coverage", () => {
    const noComplexity = valid.map((x, i) => (i === 1 ? { ...x, scope: "edge_case" as const } : x));
    expect(validateCheckItems(noComplexity, { ...rules, selectedCardPrompts: ["Time and space complexity?"] })).toEqual([]);
  });

  it("measures question overlap by shared words", () => {
    expect(questionOverlap("What does the hash map store?", "what does the HASH map store")).toBe(1);
    expect(questionOverlap("Time complexity?", "Which edge case breaks it?")).toBe(0);
  });
});

describe("validateCheckItems with unsectioned notes", () => {
  it("lets an empty ref cite Notes that has no sections", () => {
    const base: CheckRules = {
      notesSections: [],
      cardKeys: [],
      submissionIds: [],
      selectedCardPrompts: [],
      recentQuestions: [],
      requireMistakeReview: false,
    };
    const items: CheckDraftItem[] = [
      { question: "Which greedy idea drives the schedule?", choices: ["A", "B", "C", "D"], correctAnswer: "A", scope: "approach", sourceKind: "notes", sourceRef: "" },
      { question: "What is the running time overall?", choices: ["A", "B", "C", "D"], correctAnswer: "A", scope: "complexity", sourceKind: "statement", sourceRef: "" },
      { question: "Which input breaks the naive count?", choices: ["A", "B", "C", "D"], correctAnswer: "A", scope: "edge_case", sourceKind: "statement", sourceRef: "" },
    ];
    expect(validateCheckItems(items, { ...base, notesWithoutSections: true })).toEqual([]);
    expect(validateCheckItems(items, base)).toEqual([{ rule: "citation", item: 0 }]);
  });
});

describe("talk-through targets and score", () => {
  const at = (days: number) => new Date(Date.UTC(2026, 9, 5) - days * 86_400_000);
  it("takes this problem's weak spots first, then a weak category, then core", async () => {
    const { selectPracticeTargets } = await import("./practice");
    const targets = selectPracticeTargets({
      problemWeaknesses: [
        { id: "a", category: "init_sentinel", detail: "dp starts at 0", lastSeenAt: at(5) },
        { id: "b", category: "efficiency", detail: "no memo, TLE", lastSeenAt: at(1) },
        { id: "c", category: "edge_cases", detail: "empty input", lastSeenAt: at(9) },
      ],
      weakCategories: ["init_sentinel", "boundary_index", "complexity"],
    });
    expect(targets.map((t) => t.id)).toEqual(["w-b", "w-a", "c-boundary_index"]);
  });

  it("fills with approach and complexity when there are no weak spots", async () => {
    const { selectPracticeTargets } = await import("./practice");
    expect(selectPracticeTargets({ problemWeaknesses: [], weakCategories: [] }).map((t) => t.id)).toEqual([
      "k-approach",
      "k-complexity",
    ]);
    expect(
      selectPracticeTargets({ problemWeaknesses: [], weakCategories: ["complexity"] }).map((t) => t.id),
    ).toEqual(["c-complexity", "k-approach"]);
  });

  it("scores grades, with Easy only for all correct", async () => {
    const { scoreTalk } = await import("./practice");
    expect(scoreTalk(["correct", "correct", "correct"])).toEqual({ score: 1, rating: 4 });
    expect(scoreTalk(["correct", "partial", "correct"]).rating).toBe(3);
    expect(scoreTalk(["missed", "partial", "correct"]).rating).toBe(2);
    expect(scoreTalk(["missed", "missed", "partial"]).rating).toBe(1);
  });

  it("never suggests Easy for a talk-through ended early", async () => {
    const { scoreTalk } = await import("./practice");
    expect(scoreTalk(["correct"], { endedEarly: true })).toEqual({ score: 1, rating: 3 });
    expect(scoreTalk(["missed"], { endedEarly: true }).rating).toBe(1);
  });
});
