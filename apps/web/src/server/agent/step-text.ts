/**
 * Accumulates Study Coach text across agent steps. The model often writes a
 * short preamble, calls a tool, then continues in a new step; without a
 * separator the two runs of text collide ("…for this problem.Your first…").
 * A paragraph break is inserted when text resumes after a step boundary.
 */
export function createStepTextBuffer() {
  let content = "";
  let stepBoundary = false;

  return {
    startStep() {
      if (content.trim()) stepBoundary = true;
    },
    /** Appends a delta and returns the text to stream (possibly with a leading break). */
    push(delta: string) {
      let text = delta;
      if (stepBoundary && delta.trim()) {
        stepBoundary = false;
        const trailingBreaks = content.match(/\n*$/)?.[0].length ?? 0;
        if (trailingBreaks < 2) text = "\n".repeat(2 - trailingBreaks) + delta.replace(/^\n+/, "");
      }
      content += text;
      return text;
    },
    get content() {
      return content;
    },
  };
}
