import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  TALK_APPROACH_STATUSES,
  TALK_REPLIES,
  type TalkJudgement,
  type TalkReference,
} from "@ankify/core";
import type { TalkLogEntry } from "@ankify/db";
import { aiCallOptions, type CallReasoning } from "./ai/call-options";
import type { AiRuntimeSettings } from "./settings";

/**
 * The practice judge (docs/coach-practice.md, version 3): a structured call,
 * separate from the Coach the user is talking to, that reads the replies on
 * one question against its reference and ticks each key point as said or not.
 * It decides nothing: code turns its reading into the next move and the grade
 * (advanceTalk in packages/core/src/practice-talk.ts).
 */

const TIMEOUT_MS = 30_000;
const STATEMENT_MAX = 1_500;

const judgementSchema = z.object({
  reply: z.enum(TALK_REPLIES as [TalkJudgement["reply"], ...TalkJudgement["reply"][]]),
  approachId: z.string().max(10).nullable(),
  approachStatus: z.enum(TALK_APPROACH_STATUSES as [TalkJudgement["approachStatus"], ...TalkJudgement["approachStatus"][]]),
  covered: z.array(z.string().max(10)).max(12),
  misconception: z.string().max(200).nullable(),
  newApproachComplete: z.boolean(),
});

const disputeSchema = z.object({
  approachId: z.string().max(10).nullable(),
  points: z.array(z.object({ id: z.string().max(10), firstReply: z.number().int().min(1).max(50).nullable() })).max(12),
  newApproachComplete: z.boolean(),
});
export type DisputeReading = z.infer<typeof disputeSchema>;

export type JudgeInput = {
  problem: { title: string; difficulty: string; statement: string };
  /** What this question checks, for the judge (not the Coach's wording). */
  question: string;
  reference: TalkReference;
  /** The question's conversation so far; the last learner line is the reply being judged. */
  log: TalkLogEntry[];
};

/* Replies that need no model call. */
const SKIP = /^(skip|pass|next|show me( the answer)?|give up|i give up|跳过|下一题|放弃|告诉我答案|直接告诉我)[.!。！]*$/i;
const BLANK = /^(i don'?t know|idk|no idea|not sure|i forgot|forgot|don'?t remember|不知道|不会|忘了|不记得了?|没印象)[.!。！]*$/i;

export function shortcutJudgement(reply: string): TalkJudgement | null {
  const text = reply.trim();
  const base = { approachId: null, approachStatus: "unclear" as const, covered: [], misconception: null, newApproachComplete: false };
  if (SKIP.test(text)) return { ...base, reply: "give_up" };
  if (BLANK.test(text)) return { ...base, reply: "blank" };
  return null;
}

function referenceText(reference: TalkReference): string {
  return reference.approaches
    .map((approach) =>
      [
        reference.mode === "avoid_mistake"
          ? `## [${approach.id}] A mistake this learner made before on this problem`
          : `## [${approach.id}] ${approach.name}${approach.mine ? " (the learner's own accepted approach)" : ""}`,
        ...approach.points.map((point) => `- [${point.id}] ${point.text}`),
      ].join("\n"),
    )
    .join("\n\n");
}

function conversationText(log: TalkLogEntry[]): string {
  let reply = 0;
  return log
    .map((entry) => (entry.role === "tutor" ? `Tutor: ${entry.text}` : `Learner reply ${++reply}: ${entry.text}`))
    .join("\n\n");
}

function promptText(input: JudgeInput): string {
  return [
    `# Problem: ${input.problem.title} (${input.problem.difficulty})`,
    input.problem.statement || "(statement not captured)",
    "",
    "# What this question checks",
    input.question,
    "",
    "# Reference",
    referenceText(input.reference),
    "",
    "# Conversation on this question, oldest first",
    conversationText(input.log),
  ].join("\n");
}

const READING_RULES = `- Credit only what the learner's own replies say. Tutor lines show what was asked; never credit a point because the tutor said it.
- A point is covered when the learner states its idea, in any words or language, in prose or in code. Judge the idea, not the wording: paraphrases and equivalent reasoning count. A high-level idea counts; walking through code line by line doesn't, unless the code clearly embodies the idea.
- A complexity point is covered only when the learner states the cost (time and space if the point gives both). Never infer it from the approach they described; a different cost is a misconception.
- A mistake reference ("a mistake this learner made before") is covered only when the learner states the correct handling. Repeating the mistake, or describing it, doesn't cover it: that's a misconception.`;

const JUDGE_SYSTEM = `You check a learner's replies in a spoken-style review of one LeetCode problem against a reference. You don't talk to the learner; your reading only decides what the tutor does next.

Return one JSON object of this shape and nothing else:
{"reply": "...", "approachId": "..." or null, "approachStatus": "...", "covered": ["p1", ...], "misconception": "..." or null, "newApproachComplete": false}

${READING_RULES}
- covered: the point ids of the approach in approachId that the learner's replies so far cover, all replies together.
- approachId: the reference approach the learner follows (its id in brackets), or null. A mistake reference has one approach; use its id when the replies address it.
- approachStatus: known (follows a reference approach), new_valid (a correct approach the reference doesn't have, fast enough for the constraints), suboptimal (works but too slow for the constraints), invalid (would give wrong answers), unclear (too vague or too short to tell). When unsure, choose unclear.
- misconception: a wrong claim in the latest reply (a wrong idea, a wrong cost, a wrong case, or repeating the recorded mistake), in a few words; null if none. A missing point is not a misconception.
- reply, for the latest learner reply: answer (attempts the question, even partly or vaguely), blank (doesn't remember, nothing relevant), misread (answers a different question than the one asked), side_question (asks something else or chats), hint_request (asks for a hint), give_up (asks to skip or to see the answer).
- newApproachComplete: for new_valid only, true when the replies explain that approach fully, cost included; otherwise false.`;

const DISPUTE_SYSTEM = `You re-check a learner's replies in a spoken-style review of one LeetCode problem against a reference. The learner disputes the result, so read every reply carefully and generously: credit any wording that states a point's idea.

Return one JSON object of this shape and nothing else:
{"approachId": "..." or null, "points": [{"id": "p1", "firstReply": 1 or null}], "newApproachComplete": false}

${READING_RULES}
- approachId: the reference approach the learner follows (its id in brackets), or null.
- points: every point of that approach, each with the number of the first learner reply that states it, or null if no reply does.
- newApproachComplete: true when the learner explains a correct approach the reference doesn't have, fully, cost included; otherwise false.`;

async function call<T>(
  args: { model: LanguageModel; settings: AiRuntimeSettings; abortSignal?: AbortSignal },
  schema: z.ZodType<T>,
  system: string,
  prompt: string,
  reasoning: CallReasoning,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const abort = () => controller.abort();
  args.abortSignal?.addEventListener("abort", abort, { once: true });
  const attempt = async () => {
    const { output } = await generateText({
      model: args.model,
      output: Output.object({ schema }),
      system,
      prompt: `${prompt}\n\nReturn the JSON object now.`,
      // Thinking counts against the cap, so a call at the user's level needs room.
      maxOutputTokens: reasoning === "user" ? 16_000 : 1_500,
      ...aiCallOptions(args.settings, reasoning),
      abortSignal: controller.signal,
    });
    return output;
  };
  try {
    try {
      return await attempt();
    } catch (error) {
      // Providers without native structured output sometimes return JSON
      // that doesn't fit; one more try is cheaper than falling back.
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      return await attempt();
    }
  } finally {
    clearTimeout(timer);
    args.abortSignal?.removeEventListener("abort", abort);
  }
}

/** Reads the latest reply on a question. Obvious skips and blanks need no call. */
export async function judgeReply(
  args: {
    model: LanguageModel;
    settings: AiRuntimeSettings;
    abortSignal?: AbortSignal;
    /** Only the eval overrides it (scripts/judge-eval.ts). */
    reasoning?: CallReasoning;
  },
  input: JudgeInput,
): Promise<TalkJudgement> {
  const latest = [...input.log].reverse().find((entry) => entry.role === "learner");
  const shortcut = latest ? shortcutJudgement(latest.text) : null;
  if (shortcut) return shortcut;
  // Ticking points against a good reference is the easy case for a judge, and
  // it runs on every reply: the lightest setting keeps it to a second or two.
  return call(args, judgementSchema, JUDGE_SYSTEM, promptText(input), args.reasoning ?? "lightest");
}

/** "I did say that": which reply first states each point. Rare, so it runs at
 *  the user's own reasoning level. */
export async function judgeDispute(
  args: { model: LanguageModel; settings: AiRuntimeSettings; abortSignal?: AbortSignal },
  input: JudgeInput,
): Promise<DisputeReading> {
  return call(args, disputeSchema, DISPUTE_SYSTEM, promptText(input), "user");
}

export function judgeStatement(statement: string): string {
  return statement.length <= STATEMENT_MAX ? statement : `${statement.slice(0, STATEMENT_MAX)}\n... (truncated)`;
}
