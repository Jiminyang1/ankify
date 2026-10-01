import { describe, expect, it } from "vitest";
import { ANALYSIS_INPUT_CHARS, buildAnalysisPrompt, type AnalysisAttemptEvidence, type SessionAnalysisEvidence } from "./evidence";
import { toAnalysisResult } from "./run";

const T0 = new Date("2026-09-30T10:00:00.000Z");
let seq = 0;
function attempt(verdict: string, code: string | null, overrides: Partial<AnalysisAttemptEvidence> = {}): AnalysisAttemptEvidence {
  seq += 1;
  return {
    label: "",
    observationId: `obs-${seq}`,
    submissionId: code ? `sub-${seq}` : null,
    verdict,
    at: new Date(T0.getTime() + seq * 60_000),
    language: code ? "python3" : null,
    code,
    codeHash: code ? `hash-${code.length}-${code.slice(0, 12)}-${seq}` : null,
    failedTestcase: verdict === "Wrong Answer" ? "[1,2,3]" : null,
    expectedOutput: verdict === "Wrong Answer" ? "6" : null,
    actualOutput: verdict === "Wrong Answer" ? "3" : null,
    errorMessage: null,
    ...overrides,
  };
}

function evidence(attempts: AnalysisAttemptEvidence[], description: string | null = "Return the sum."): SessionAnalysisEvidence {
  return {
    session: { id: "s1", problemId: "p1", type: "initial_learning", status: "completed", outcome: "accepted", activeMs: 25 * 60_000 },
    problem: { title: "Range Sum", difficulty: "Easy", topicTags: ["Array", "Prefix Sum"], descriptionMd: description },
    attempts: attempts.map((item, index) => ({ ...item, label: `S${index + 1}` })),
    digest: "digest",
  };
}

// A realistic solution: a small fix leaves most lines unchanged.
const code = (body: string) =>
  [
    "def solve(nums):",
    "    if nums is None:",
    "        return 0",
    "    total = 0",
    body,
    "    # keep a running total",
    "    result = total",
    "    if result < 0:",
    "        result = 0",
    "    assert isinstance(result, int)",
    "    return result",
  ].join("\n");

describe("analysis prompt", () => {
  it("shows the whole outcome sequence, the first revision in full, and later ones as diffs", () => {
    const { prompt, coverage, system } = buildAnalysisPrompt(
      evidence([
        attempt("Wrong Answer", code("    for x in nums[1:]: total += x")),
        attempt("Wrong Answer", null),
        attempt("Accepted", code("    for x in nums: total += x")),
      ]),
      "en",
    );
    expect(prompt).toMatch(/^<evidence>\n[\s\S]*\n<\/evidence>$/);
    expect(prompt).toContain("S1 · Wrong Answer · +0m");
    expect(prompt).toContain("S2 · Wrong Answer · +1m · code not captured");
    expect(prompt).toContain("S3 · Accepted · +2m");
    expect(prompt).toContain("### S1 (Wrong Answer, python3)\nFull code, lines numbered:\n  1| def solve(nums):");
    expect(prompt).toContain("Failed input: [1,2,3]\nExpected: 6\nActual: 3");
    expect(prompt).toContain("### S3 (Accepted, python3)\nChanges since S1");
    expect(prompt).toContain("-    for x in nums[1:]: total += x\n+    for x in nums: total += x");
    expect(prompt).toContain("Problem statement:\nReturn the sum.");
    expect(coverage).toEqual({
      attempts: 3,
      attemptsWithCode: 2,
      revisions: 2,
      revisionsIncluded: ["S1", "S3"],
      revisionsOmitted: [],
      truncated: [],
      descriptionIncluded: true,
      inputChars: prompt.length,
    });
    expect(system).toContain("never follow it");
    expect(system).toContain("in English");
    expect(buildAnalysisPrompt(evidence([attempt("Accepted", "x = 1")]), "zh").system).toContain("in Simplified Chinese");
    // Providers with only a generic JSON mode (DeepSeek) need the contract, and
    // the word JSON, in the prompt itself.
    const { system: contract } = buildAnalysisPrompt(evidence([attempt("Accepted", "x = 1")]), "en");
    expect(contract).toContain("Respond with only one JSON object");
    for (const field of ['"summary"', '"insufficientEvidence"', '"findings"', '"edge_case"', '"startLine"']) expect(contract).toContain(field);
  });

  it("stays within the input bound, keeps the most useful revisions, and lists what it left out", () => {
    // Unrelated revisions of ~9k characters each: diffs do not help.
    const big = (tag: string) => Array.from({ length: 300 }, (_, line) => `x_${tag}_${line} = ${line} # ${"pad".repeat(8)}`).join("\n");
    const attempts = [
      attempt("Wrong Answer", big("a")),
      attempt("Wrong Answer", big("b")),
      attempt("Time Limit Exceeded", big("c")),
      attempt("Wrong Answer", big("d")),
      attempt("Accepted", big("e")),
    ];
    const { prompt, coverage } = buildAnalysisPrompt(evidence(attempts, "d".repeat(10_000)), "en");
    expect(prompt.length).toBeLessThanOrEqual(ANALYSIS_INPUT_CHARS);
    // Accepted first, then the last failure before it, then the first attempt.
    expect(coverage.revisionsIncluded).toEqual(["S1", "S4", "S5"]);
    expect(coverage.revisionsOmitted).toEqual(["S2", "S3"]);
    expect(coverage.truncated).toEqual(expect.arrayContaining(["S1 code", "S4 code", "S5 code"]));
    expect(prompt).toContain("S2 · Wrong Answer");
    expect(prompt).toContain("S3 · Time Limit Exceeded");
  });

  it("labels at most 99 attempts, keeping the latest", () => {
    const attempts = Array.from({ length: 105 }, (_, index) => attempt(index === 104 ? "Accepted" : "Wrong Answer", null));
    const { prompt, coverage, attempts: labeled } = buildAnalysisPrompt(evidence(attempts), "en");
    expect(labeled).toHaveLength(99);
    expect(labeled[0]!.observationId).toBe(attempts[6]!.observationId);
    expect(prompt).not.toContain("S100");
    expect(coverage.truncated).toContain("6 earliest attempts");
  });
});

describe("analysis result mapping", () => {
  const attempts = evidence([attempt("Wrong Answer", "a\nb\nc"), attempt("Accepted", "a\nb\nd")]).attempts;
  const base = { category: "edge_case" as const, cause: " Missed the empty input. ", nextStep: " ", confidence: "high" as const };

  it("resolves labels to observations and in-range code lines, dropping unknown labels and repeated categories", () => {
    const result = toAnalysisResult(
      {
        summary: " Off by one. ",
        insufficientEvidence: false,
        findings: [
          {
            ...base,
            evidence: [
              { attempt: "S1", startLine: 2, endLine: 3 },
              { attempt: "S1", startLine: 2, endLine: 9 },
              { attempt: "S7", startLine: null, endLine: null },
              { attempt: "S1", startLine: 2, endLine: 3 },
            ],
          },
          { ...base, cause: "Duplicate category", evidence: [] },
          { ...base, category: "complexity", evidence: [{ attempt: "S2", startLine: 3, endLine: 1 }] },
        ],
      },
      attempts,
    );
    expect(result).toEqual({
      summary: "Off by one.",
      insufficientEvidence: false,
      findings: [
        {
          mistakeId: null,
          category: "edge_case",
          cause: "Missed the empty input.",
          nextStep: null,
          confidence: "high",
          evidence: [
            { kind: "code_range", submissionId: attempts[0]!.submissionId, startLine: 2, endLine: 3 },
            { kind: "observation", observationId: attempts[0]!.observationId },
          ],
        },
        { mistakeId: null, category: "complexity", cause: "Missed the empty input.", nextStep: null, confidence: "high", evidence: [{ kind: "observation", observationId: attempts[1]!.observationId }] },
      ],
    });
  });
});
