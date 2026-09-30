import { describe, expect, it } from "vitest";
import { unifiedLineDiff } from "./diff";

describe("unified line diff", () => {
  it("shows a changed line with context and positions in both versions", () => {
    const before = ["def f(n):", "    total = 0", "    for i in range(n):", "        total += i", "    return total"].join("\n");
    const after = ["def f(n):", "    total = 0", "    for i in range(n + 1):", "        total += i", "    return total"].join("\n");
    expect(unifiedLineDiff(before, after)).toBe(
      ["@@ -1,5 +1,5 @@", " def f(n):", "     total = 0", "-    for i in range(n):", "+    for i in range(n + 1):", "         total += i", "     return total"].join("\n"),
    );
  });

  it("splits distant changes into hunks and handles additions at the end", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const after = [...lines];
    after[1] = "changed 2";
    after.push("added 21");
    const diff = unifiedLineDiff(lines.join("\n"), after.join("\n"))!;
    expect(diff.split("\n").filter((line) => line.startsWith("@@"))).toEqual(["@@ -1,4 +1,4 @@", "@@ -19,2 +19,3 @@"]);
    expect(diff).toContain("+added 21");
  });

  it("is empty for identical code and null for oversized input", () => {
    expect(unifiedLineDiff("a\nb", "a\nb")).toBe("");
    expect(unifiedLineDiff("x\n".repeat(1_001), "y")).toBeNull();
  });
});
