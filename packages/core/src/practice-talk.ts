/**
 * Talk-through practice judged against a reference (docs/coach-practice.md,
 * version 3). For each reply the server asks a judge which reference points
 * the user has covered (a separate structured call), and this code decides the
 * Coach's next move and the grade. The Coach only phrases the move.
 *
 * The grade answers one question: did the user recall it themselves? The help
 * given so far caps it: none or content-free nudges ("anything else?") can be
 * correct, naming the missing part caps it at partial, and a hint with content
 * (or a counterexample, or an explanation) makes it missed.
 */

/** What kind of message the user's latest reply is. */
export type TalkReply =
  /** Attempts the question. */
  | "answer"
  /** Doesn't remember: no idea, or nothing relevant. */
  | "blank"
  /** Answers a different question than the one asked. */
  | "misread"
  /** Asks something else, or chats. */
  | "side_question"
  | "hint_request"
  /** Wants to skip or see the answer. */
  | "give_up";

export const TALK_REPLIES: readonly TalkReply[] = [
  "answer",
  "blank",
  "misread",
  "side_question",
  "hint_request",
  "give_up",
];

/** How the user's approach relates to the reference. */
export type TalkApproachStatus =
  /** Follows a reference approach. */
  | "known"
  /** A correct approach the reference doesn't have. */
  | "new_valid"
  /** Works, but too slow for the constraints. */
  | "suboptimal"
  /** Would give wrong answers. */
  | "invalid"
  /** Too vague or too short to tell. */
  | "unclear";

export const TALK_APPROACH_STATUSES: readonly TalkApproachStatus[] = [
  "known",
  "new_valid",
  "suboptimal",
  "invalid",
  "unclear",
];

/** The judge's reading of the replies so far on one target. */
export type TalkJudgement = {
  reply: TalkReply;
  /** The reference approach the user follows, when known. */
  approachId: string | null;
  approachStatus: TalkApproachStatus;
  /** Point ids of that approach the user's replies cover (cumulative). */
  covered: string[];
  /** A wrong claim in the latest reply, in a few words. */
  misconception: string | null;
  /** new_valid only: the replies explain that approach fully, cost included. */
  newApproachComplete: boolean;
};

/** The reference a target is judged against: one or more approaches, each
 *  with its key points. A weak-spot target has one approach with one point. */
export type TalkReference = {
  /** key_points: explain the approach; avoid_mistake: the point is a mistake
   *  the user made before, covered when they now get it right. */
  mode: "key_points" | "avoid_mistake";
  approaches: { id: string; name: string; mine: boolean; points: { id: string; text: string }[] }[];
};

/** How much help a target has had: none, its gap named, a hint with content. */
export type TalkHelp = 0 | 1 | 2;

export type TalkGrade = "correct" | "partial" | "missed";

export type TalkSettledBy =
  /** Every point covered (the help given caps the grade). */
  | "complete"
  /** A valid approach the reference doesn't have. */
  | "new_approach"
  | "gave_up"
  /** Still missing after a hint, or out of nudges: explained. */
  | "not_recalled";

export type TalkTargetState = {
  help: TalkHelp;
  /** Nudges given so far (any move that asked again). */
  nudges: number;
  /** The free "anything else?" was used. */
  probed: boolean;
  /** The free "can it be faster?" was used. */
  askedFaster: boolean;
  approachId: string | null;
  covered: string[];
  /** Point ids whose gap was named, and ones given a hint. */
  named: string[];
  hinted: string[];
  newApproach: boolean;
};

export const EMPTY_TALK_STATE: TalkTargetState = {
  help: 0,
  nudges: 0,
  probed: false,
  askedFaster: false,
  approachId: null,
  covered: [],
  named: [],
  hinted: [],
  newApproach: false,
};

/** Nudges before the Coach explains and moves on. */
export const MAX_TALK_NUDGES = 3;

export const GRADE_BY_HELP: Record<TalkHelp, TalkGrade> = { 0: "correct", 1: "partial", 2: "missed" };

export type TalkPointRef = { approachId: string; pointId: string };

/** The Coach's next move. */
export type TalkMove =
  /** Content-free: "anything else?", "why does that work?", or "can it be faster?". */
  | { kind: "probe"; reason: "more" | "faster" }
  /** Name the missing part without its content. */
  | { kind: "name_gap"; point: TalkPointRef }
  /** The smallest hint with content, or a counterexample to a wrong idea. */
  | { kind: "hint"; point: TalkPointRef | null; misconception: string | null }
  /** Not an answer: answer the side question or rephrase, then ask again. */
  | { kind: "reask"; reason: "side_question" | "misread" }
  /** The target is settled; a missed one ends with the full answer. */
  | { kind: "settle"; grade: TalkGrade; by: TalkSettledBy };

export type TalkStep = { state: TalkTargetState; move: TalkMove };

const worse = (a: TalkGrade, b: TalkGrade): TalkGrade =>
  a === "missed" || b === "missed" ? "missed" : a === "partial" || b === "partial" ? "partial" : "correct";

/** The approach to steer toward when the user's own isn't known: theirs
 *  ("mine") first, then the doc's first. */
function preferredApproach(reference: TalkReference) {
  return reference.approaches.find((approach) => approach.mine) ?? reference.approaches[0] ?? null;
}

/** The next move and the new state for one reply about the current target. */
export function advanceTalk(state: TalkTargetState, judgement: TalkJudgement, reference: TalkReference): TalkStep {
  if (judgement.reply === "side_question" || judgement.reply === "misread") {
    return { state, move: { kind: "reask", reason: judgement.reply } };
  }
  const settle = (next: TalkTargetState, grade: TalkGrade, by: TalkSettledBy): TalkStep => ({
    state: next,
    move: { kind: "settle", grade, by },
  });
  if (judgement.reply === "give_up") return settle({ ...state, help: 2 }, "missed", "gave_up");

  // A single-approach reference (a weak spot) needs no approach match.
  const single = reference.approaches.length === 1 && reference.mode === "avoid_mistake" ? reference.approaches[0]! : null;
  const approach = reference.approaches.find((candidate) => candidate.id === judgement.approachId) ?? single;
  let next: TalkTargetState = { ...state };
  if (approach) {
    // Switching approach starts its points over. Repeating a recorded mistake
    // never covers it, whatever the judge ticked.
    const kept = approach.id === state.approachId ? state.covered : [];
    const ids = new Set(approach.points.map((point) => point.id));
    const ticked = reference.mode === "avoid_mistake" && judgement.misconception ? [] : judgement.covered;
    next = {
      ...next,
      approachId: approach.id,
      covered: [...new Set([...kept, ...ticked.filter((id) => ids.has(id))])],
    };
  }
  const missing = approach ? approach.points.filter((point) => !next.covered.includes(point.id)) : [];

  // A wrong claim keeps it open, even with every point said.
  if (approach && missing.length === 0 && !judgement.misconception) {
    return settle(next, GRADE_BY_HELP[next.help], "complete");
  }
  if (judgement.approachStatus === "new_valid") {
    next = { ...next, newApproach: true };
    if (judgement.newApproachComplete) return settle(next, GRADE_BY_HELP[next.help], "new_approach");
  }

  if (next.nudges >= MAX_TALK_NUDGES) return settle({ ...next, help: 2 }, "missed", "not_recalled");

  const nudge = (move: TalkMove, help: TalkHelp, extra: Partial<TalkTargetState> = {}): TalkStep => ({
    state: { ...next, ...extra, nudges: next.nudges + 1, help: Math.max(next.help, help) as TalkHelp },
    move,
  });
  const steerTo = approach ?? preferredApproach(reference);
  const firstGap = (approach ? missing[0] : steerTo?.points[0]) ?? null;
  const gapRef = firstGap && steerTo ? { approachId: steerTo.id, pointId: firstGap.id } : null;
  const hint = (misconception: string | null = null) =>
    nudge({ kind: "hint", point: gapRef, misconception }, 2, gapRef ? { hinted: [...next.hinted, gapRef.pointId] } : {});

  // A wrong idea gets a counterexample; asking for a hint gets one.
  if (judgement.misconception || judgement.approachStatus === "invalid") return hint(judgement.misconception);
  if (judgement.reply === "hint_request") return hint();
  if (judgement.approachStatus === "suboptimal") {
    return next.askedFaster ? hint() : nudge({ kind: "probe", reason: "faster" }, 0, { askedFaster: true });
  }
  if (judgement.approachStatus === "new_valid") {
    // No reference points to name: one free "say more", then settle on it.
    if (!next.probed) return nudge({ kind: "probe", reason: "more" }, 0, { probed: true });
    return settle(next, worse(GRADE_BY_HELP[next.help], "partial"), "new_approach");
  }
  if (judgement.reply === "blank") {
    // Nothing recalled: the smallest hint; still nothing after it, explain.
    if (next.help >= 2) return settle(next, "missed", "not_recalled");
    return hint();
  }
  // An answer: one free "anything else?", then name each gap, then hint it,
  // then explain.
  if (!next.probed) return nudge({ kind: "probe", reason: "more" }, 0, { probed: true });
  if (!gapRef) return hint();
  if (next.hinted.includes(gapRef.pointId)) return settle({ ...next, help: 2 }, "missed", "not_recalled");
  if (next.named.includes(gapRef.pointId)) return hint();
  return nudge({ kind: "name_gap", point: gapRef }, 1, { named: [...next.named, gapRef.pointId] });
}
