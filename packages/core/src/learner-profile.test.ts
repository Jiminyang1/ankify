import { describe, expect, it } from "vitest";
import { applyLearnerProfileEdit, MAX_LEARNER_PROFILE_LENGTH, parseLearnerProfile } from "./learner-profile";

const profile = `## 写题语言
- Java

## 讲解方式
- 先讲直觉，再讲严格证明

Something the user wrote by hand.
`;

describe("applyLearnerProfileEdit", () => {
  it("starts a doc with the first section", () => {
    const result = applyLearnerProfileEdit("", { op: "remember", section: "Language", text: "  Codes in   Python " });
    expect(result).toEqual({ ok: true, markdown: "## Language\n- Codes in Python\n", changed: true });
  });

  it("adds to an existing section after its last line, keeping the rest", () => {
    const result = applyLearnerProfileEdit(profile, { op: "remember", section: "写题语言", text: "也会用 C++" });
    expect(result.ok && result.markdown).toBe(`## 写题语言
- Java
- 也会用 C++

## 讲解方式
- 先讲直觉，再讲严格证明

Something the user wrote by hand.
`);
  });

  it("appends a new section at the end", () => {
    const result = applyLearnerProfileEdit(profile, { op: "remember", section: "## 目标", text: "11 月底面试" });
    expect(result.ok && result.markdown.endsWith("Something the user wrote by hand.\n\n## 目标\n- 11 月底面试\n")).toBe(true);
  });

  it("does nothing for a fact that's already there", () => {
    const result = applyLearnerProfileEdit(profile, { op: "remember", section: "写题语言", text: "java." });
    expect(result).toEqual({ ok: true, markdown: profile, changed: false });
  });

  it("rewrites a bullet in place, or folds it into one that says the same", () => {
    const rewritten = applyLearnerProfileEdit(profile, { op: "remember", section: "写题语言", text: "Python", replace: "Java" });
    expect(rewritten.ok && rewritten.markdown.startsWith("## 写题语言\n- Python\n\n## 讲解方式")).toBe(true);

    const two = "## Lang\n- Java\n- Python\n";
    const folded = applyLearnerProfileEdit(two, { op: "remember", section: "lang", text: "Python", replace: "Java" });
    expect(folded.ok && folded.markdown).toBe("## Lang\n- Python\n");
  });

  it("forgets a bullet, and the section once it's empty", () => {
    const result = applyLearnerProfileEdit(profile, { op: "forget", section: "写题语言", text: "Java" });
    expect(result.ok && result.markdown).toBe(`## 讲解方式
- 先讲直觉，再讲严格证明

Something the user wrote by hand.
`);
  });

  it("rejects unknown bullets, empty or long input, and a doc that would grow too big", () => {
    expect(applyLearnerProfileEdit(profile, { op: "forget", section: "写题语言", text: "Go" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(applyLearnerProfileEdit(profile, { op: "remember", section: "目标", text: "x", replace: "y" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(applyLearnerProfileEdit(profile, { op: "remember", section: " ", text: "x" })).toEqual({ ok: false, error: "empty" });
    expect(applyLearnerProfileEdit(profile, { op: "remember", section: "a", text: "x".repeat(201) })).toEqual({
      ok: false,
      error: "too_long",
    });
    const big = `## Notes\n${"- filler line for the profile\n".repeat(80)}`.slice(0, MAX_LEARNER_PROFILE_LENGTH - 5);
    expect(applyLearnerProfileEdit(big, { op: "remember", section: "Notes", text: "one more fact" })).toEqual({
      ok: false,
      error: "full",
    });
  });
});

describe("parseLearnerProfile", () => {
  it("treats anything malformed as empty", () => {
    expect(parseLearnerProfile(null)).toEqual({ markdown: "", version: 0 });
    expect(parseLearnerProfile({ notes: [] })).toEqual({ markdown: "", version: 0 });
    expect(parseLearnerProfile({ markdown: "## A\n- b\n", version: 3 })).toEqual({ markdown: "## A\n- b\n", version: 3 });
  });
});
