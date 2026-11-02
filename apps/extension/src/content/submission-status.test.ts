import { describe, expect, it } from "vitest";
import { storedVerdict, submissionVerdict } from "./submission-status";

describe("submissionVerdict", () => {
  it("keeps leetcode.com's English verdicts", () => {
    expect(submissionVerdict({ statusDisplay: "Accepted" })).toBe("Accepted");
    expect(submissionVerdict({ statusDisplay: "Wrong Answer" })).toBe("Wrong Answer");
    expect(submissionVerdict({ statusDisplay: "Some New Verdict" })).toBe("Some New Verdict");
  });

  it("reads leetcode.cn's Chinese labels", () => {
    expect(submissionVerdict({ statusDisplay: "通过", status: "AC", isPending: "Not Pending" })).toBe("Accepted");
    expect(submissionVerdict({ statusDisplay: "解答错误" })).toBe("Wrong Answer");
    expect(submissionVerdict({ statusDisplay: "编译出错" })).toBe("Compile Error");
  });

  it("falls back to leetcode.cn's status code for an unknown label", () => {
    expect(submissionVerdict({ statusDisplay: "新的说法", status: "AC" })).toBe("Accepted");
    expect(submissionVerdict({ statusDisplay: null, status: 11 })).toBe("Wrong Answer");
  });

  it("treats a row still being judged as pending", () => {
    expect(submissionVerdict({ statusDisplay: "通过", isPending: "Pending" })).toBe("Pending");
    expect(submissionVerdict({ statusDisplay: "", status: null })).toBe("Pending");
    expect(submissionVerdict({ isPending: true })).toBe("Pending");
  });
});

describe("storedVerdict", () => {
  it("keeps the verdicts ankify stores and calls the rest Other", () => {
    expect(storedVerdict("Accepted")).toBe("Accepted");
    expect(storedVerdict("Compile Error")).toBe("Compile Error");
    expect(storedVerdict("Output Limit Exceeded")).toBe("Other");
  });
});
