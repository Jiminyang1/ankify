import { describe, expect, it } from "vitest";
import { automaticAnalysisTrigger, hasAnalyzableCode, type AutomaticAnalysisInput } from "./session-analysis";

const input = (overrides: Partial<AutomaticAnalysisInput>): AutomaticAnalysisInput => ({
  outcome: "accepted",
  attempts: [],
  matchesConfirmedPattern: false,
  ...overrides,
});
const wa = (codeHash: string | null) => ({ verdict: "Wrong Answer", codeHash });
const ac = (codeHash: string | null = "final") => ({ verdict: "Accepted", codeHash });

describe("automatic analysis triggers", () => {
  it("fires for two distinct failed revisions followed by Accepted", () => {
    expect(automaticAnalysisTrigger(input({ attempts: [wa("a"), wa("b"), ac()] }))).toBe("repeated_failures");
  });

  it("fires for any other failure with code, with or without Accepted", () => {
    expect(automaticAnalysisTrigger(input({ attempts: [wa("a"), wa("a"), ac()] }))).toBe("failed_attempt");
    expect(automaticAnalysisTrigger(input({ attempts: [wa("a"), wa(null), ac()] }))).toBe("failed_attempt");
    expect(automaticAnalysisTrigger(input({ attempts: [wa("a"), ac(), wa("b")] }))).toBe("failed_attempt");
    expect(automaticAnalysisTrigger(input({ outcome: "failed", attempts: [wa("a"), wa("b")] }))).toBe("failed_attempt");
    expect(automaticAnalysisTrigger(input({ outcome: "failed", attempts: [{ verdict: "Compile Error", codeHash: "x" }] }))).toBe("failed_attempt");
  });

  it("fires for a failure matching a confirmed pattern elsewhere, only with failed code", () => {
    expect(automaticAnalysisTrigger(input({ outcome: "failed", attempts: [wa("a")], matchesConfirmedPattern: true }))).toBe("pattern_recurrence");
    expect(automaticAnalysisTrigger(input({ outcome: "failed", attempts: [wa(null)], matchesConfirmedPattern: true }))).toBeNull();
  });

  it("never fires without a failure that has code", () => {
    expect(automaticAnalysisTrigger(input({ attempts: [ac()] }))).toBeNull();
    expect(automaticAnalysisTrigger(input({ attempts: [ac(), ac("other")] }))).toBeNull();
    expect(automaticAnalysisTrigger(input({ outcome: "failed", attempts: [wa(null)] }))).toBeNull();
    expect(automaticAnalysisTrigger(input({ outcome: null, attempts: [] }))).toBeNull();
  });

  it("allows a manual analysis once any code was captured", () => {
    expect(hasAnalyzableCode([wa(null), ac(null)])).toBe(false);
    expect(hasAnalyzableCode([wa(null), ac("x")])).toBe(true);
  });
});
