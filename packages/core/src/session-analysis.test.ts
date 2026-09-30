import { describe, expect, it } from "vitest";
import { automaticAnalysisTrigger, hasAnalyzableCode, type AutomaticAnalysisInput } from "./session-analysis";

const input = (overrides: Partial<AutomaticAnalysisInput>): AutomaticAnalysisInput => ({
  outcome: "accepted",
  attempts: [],
  matchesConfirmedPattern: false,
  testsImprovement: false,
  ...overrides,
});
const wa = (codeHash: string | null) => ({ verdict: "Wrong Answer", codeHash });
const ac = (codeHash: string | null = "final") => ({ verdict: "Accepted", codeHash });

describe("automatic analysis triggers", () => {
  it("fires for two distinct failed revisions followed by Accepted", () => {
    expect(automaticAnalysisTrigger(input({ attempts: [wa("a"), wa("b"), ac()] }))).toBe("repeated_failures");
  });

  it("ignores resubmitting the same code, failures without code, failures after Accepted, and no Accepted", () => {
    expect(automaticAnalysisTrigger(input({ attempts: [wa("a"), wa("a"), ac()] }))).toBeNull();
    expect(automaticAnalysisTrigger(input({ attempts: [wa("a"), wa(null), ac()] }))).toBeNull();
    expect(automaticAnalysisTrigger(input({ attempts: [wa("a"), ac(), wa("b")] }))).toBeNull();
    expect(automaticAnalysisTrigger(input({ outcome: "failed", attempts: [wa("a"), wa("b")] }))).toBeNull();
  });

  it("fires for a failure matching a confirmed pattern elsewhere, only with failed code", () => {
    expect(automaticAnalysisTrigger(input({ outcome: "failed", attempts: [wa("a")], matchesConfirmedPattern: true }))).toBe("pattern_recurrence");
    expect(automaticAnalysisTrigger(input({ outcome: "failed", attempts: [wa(null)], matchesConfirmedPattern: true }))).toBeNull();
  });

  it("fires for an accepted session marked as testing an improvement", () => {
    expect(automaticAnalysisTrigger(input({ attempts: [ac()], testsImprovement: true }))).toBe("improvement_test");
    expect(automaticAnalysisTrigger(input({ outcome: "unknown", attempts: [ac()], testsImprovement: true }))).toBeNull();
    expect(automaticAnalysisTrigger(input({ attempts: [ac(null)], testsImprovement: true }))).toBeNull();
  });

  it("never fires for ordinary sessions", () => {
    expect(automaticAnalysisTrigger(input({ attempts: [ac()] }))).toBeNull();
    expect(automaticAnalysisTrigger(input({ outcome: "failed", attempts: [wa("a")] }))).toBeNull();
    expect(automaticAnalysisTrigger(input({ outcome: null, attempts: [] }))).toBeNull();
  });

  it("allows a manual analysis once any code was captured", () => {
    expect(hasAnalyzableCode([wa(null), ac(null)])).toBe(false);
    expect(hasAnalyzableCode([wa(null), ac("x")])).toBe(true);
  });
});
