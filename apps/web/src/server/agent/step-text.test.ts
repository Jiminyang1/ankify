import { describe, expect, it } from "vitest";
import { createStepTextBuffer } from "./step-text";

describe("createStepTextBuffer", () => {
  it("separates text written before and after a tool step", () => {
    const buffer = createStepTextBuffer();
    buffer.startStep();
    buffer.push("I'll look at your submissions.");
    buffer.startStep();
    expect(buffer.push("Your first attempt")).toBe("\n\nYour first attempt");
    buffer.push(" was greedy.");
    expect(buffer.content).toBe("I'll look at your submissions.\n\nYour first attempt was greedy.");
  });

  it("adds nothing when the first step produced no text", () => {
    const buffer = createStepTextBuffer();
    buffer.startStep();
    buffer.startStep();
    expect(buffer.push("Answer")).toBe("Answer");
  });

  it("does not double an existing paragraph break", () => {
    const buffer = createStepTextBuffer();
    buffer.startStep();
    buffer.push("Checking.\n\n");
    buffer.startStep();
    expect(buffer.push("Done")).toBe("Done");
    expect(buffer.content).toBe("Checking.\n\nDone");
  });

  it("waits for visible text before inserting the break", () => {
    const buffer = createStepTextBuffer();
    buffer.startStep();
    buffer.push("Checking.");
    buffer.startStep();
    expect(buffer.push("\n")).toBe("\n");
    expect(buffer.push("Done")).toBe("\nDone");
    expect(buffer.content).toBe("Checking.\n\nDone");
  });
});
