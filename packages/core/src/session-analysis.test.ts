import { describe, expect, it } from "vitest";
import { hasAnalyzableCode } from "./session-analysis";

const wa = (codeHash: string | null) => ({ verdict: "Wrong Answer", codeHash });
const ac = (codeHash: string | null = "final") => ({ verdict: "Accepted", codeHash });

describe("analyzable sessions", () => {
  it("needs at least one captured submission's code, failed or accepted", () => {
    expect(hasAnalyzableCode([])).toBe(false);
    expect(hasAnalyzableCode([wa(null), ac(null)])).toBe(false);
    expect(hasAnalyzableCode([wa(null), ac("x")])).toBe(true);
    expect(hasAnalyzableCode([ac()])).toBe(true);
    expect(hasAnalyzableCode([wa("a")])).toBe(true);
  });
});
