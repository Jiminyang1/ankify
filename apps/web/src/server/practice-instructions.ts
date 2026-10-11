import type { TalkMove, TalkReference, TalkTarget, TalkTargetState } from "@ankify/core";

/**
 * What the Coach says next in a talk-through (docs/coach-practice.md,
 * version 3), as one plain-text instruction. Code has already decided the
 * move and the grade; the Coach only phrases it, in the user's language.
 */

const RATING_NAMES = ["Again", "Hard", "Good", "Easy"] as const;

/** How the Coach opens a target's question. */
export function askInstruction(target: TalkTarget): string {
  if (target.kind === "core" && target.label !== "complexity") {
    return "Ask how they would solve this problem and what it costs in time and space, as one open question. No hints, no choices, nothing about the approach.";
  }
  if (target.kind === "core") {
    return "Ask what the time and space cost of their approach is, and why, as one open question.";
  }
  if (target.kind === "weakness") {
    return `Ask one open question about this problem that checks whether they now get this right, without mentioning the mistake or its fix. The mistake they made before: "${target.label}".`;
  }
  return `Ask one open question that applies this weak category to this problem: ${target.category ?? target.label}. Don't hint at the answer.`;
}

function pointText(reference: TalkReference, approachId: string, pointId: string): string {
  const approach = reference.approaches.find((candidate) => candidate.id === approachId);
  return approach?.points.find((point) => point.id === pointId)?.text ?? "";
}

/** The whole answer, for explaining a missed question: their approach if the
 *  judge recognized it, else their own accepted one, else the first. */
function fullAnswer(reference: TalkReference, state: TalkTargetState): string {
  const approach =
    reference.approaches.find((candidate) => candidate.id === state.approachId) ??
    reference.approaches.find((candidate) => candidate.mine) ??
    reference.approaches[0];
  if (!approach) return "";
  const heading = reference.mode === "avoid_mistake" ? "What to get right" : approach.name;
  return `${heading}:\n${approach.points.map((point) => `- ${point.text}`).join("\n")}`;
}

export type TalkNext =
  | { kind: "target"; target: TalkTarget }
  | { kind: "completed"; correct: number; total: number; suggestedRating: 1 | 2 | 3 | 4 }
  | { kind: "none" };

/** The instruction for one judged reply. `next` is what follows a settled
 *  question: the next target, or the finished session. */
export function moveInstruction(args: {
  move: TalkMove;
  reference: TalkReference;
  state: TalkTargetState;
  next: TalkNext;
}): string {
  const { move, reference, state } = args;
  switch (move.kind) {
    case "probe":
      return move.reason === "faster"
        ? "Their approach works but is too slow for the constraints. Ask whether they can do better, without saying how or naming a technique. Don't say yet whether the rest is right."
        : "Their answer is on track but not complete. Ask a content-free follow-up such as \"Anything else?\" or \"Why does that work?\". Don't name, hint at, or confirm what's missing, and don't say yet whether they're right.";
    case "name_gap":
      return `They haven't covered this point yet: "${pointText(reference, move.point.approachId, move.point.pointId)}". Ask about just that part by naming it, never its content (for example, ask what something should track or why a step is safe). Don't confirm or correct anything else yet.`;
    case "hint": {
      const point = move.point ? pointText(reference, move.point.approachId, move.point.pointId) : "";
      if (move.misconception) {
        return [
          `Their latest reply has a wrong idea: ${move.misconception}.`,
          "Give a small concrete input where it fails and ask what happens there. Don't give the fix.",
          point ? `The point it's about: "${point}".` : "",
          "If it's a specific mistake worth tracking, record it with record_weakness (evidence: this practice session).",
        ]
          .filter(Boolean)
          .join(" ");
      }
      return point
        ? `Give the smallest hint with some content toward this point, without stating it whole: "${point}". Then ask them to try again.`
        : "Give the smallest hint with some content toward a working approach, without stating it whole. Then ask them to try again.";
    }
    case "reask":
      return move.reason === "misread"
        ? "They answered a different question. Restate the current question more clearly, with no hints, and wait."
        : "Their message isn't an answer to the current question. Answer it briefly without revealing anything the question checks, then ask the current question again.";
    case "settle": {
      const lines = [`This question is settled: ${move.grade}.`];
      if (move.by === "complete") {
        lines.push(
          move.grade === "correct"
            ? "They covered every point on their own. Confirm in one line; don't repeat what they said."
            : "They got there with help. Confirm in one line; don't repeat what they said.",
        );
      } else if (move.by === "new_approach") {
        lines.push(
          "They used a valid approach that isn't in their Solutions doc. Acknowledge it in one line and mention they can add it to the Solutions doc (book icon) after practice.",
        );
      } else {
        lines.push(
          `Explain the full answer in a few short lines, covering each of these:\n${fullAnswer(reference, state)}`,
        );
      }
      lines.push(nextText(args.next));
      return lines.join("\n");
    }
  }
}

function nextText(next: TalkNext): string {
  if (next.kind === "target") return `Then the next question. ${askInstruction(next.target)}`;
  if (next.kind === "completed") {
    return `That was the last question; the session is complete: ${next.correct} of ${next.total} correct on their own, suggested rating ${RATING_NAMES[next.suggestedRating - 1]}. Give a two- or three-line summary and name the suggested rating as a suggestion; the panel shows the rating buttons.`;
  }
  return "";
}

/** The judge couldn't read this question (an error, or no reference): the
 *  Coach grades it, as in version 2. */
export function fallbackInstruction(target: TalkTarget): string {
  return `The automatic check isn't available for this question (${target.kind === "core" ? "the approach" : target.label}). Judge their answer yourself: if it's complete and right, call grade_answer with correct. If something is missing, ask one narrower question about just that part without giving it away, and grade once it's settled: partial if they needed that, missed if still wrong or they gave up. After grading, continue with the next question.`;
}
