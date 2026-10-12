import {
  hasToolCall,
  stepCountIs,
  ToolLoopAgent,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import type { AgentStepDto, PracticeSessionDto } from "@ankify/contracts";
import { aiCallOptions } from "@/server/ai/call-options";
import type { AiRuntimeSettings } from "@/server/settings";
import { compactAgentSessionIfNeeded } from "./compaction";
import { STUDY_COACH_INSTRUCTIONS } from "./prompt";
import { createStepTextBuffer } from "./step-text";
import { finishAgentRun, getAgentModelMessages } from "./store";
import { judgeTalkTurn, prepareTalkReferences, recordTutorLine, startTalkTurn } from "@/server/practice";
import { analyzeAttempts } from "./analyze-attempts";
import { createStudyCoachTools } from "./tools";

const AGENT_TIMEOUT_MS = 175_000;

export async function runStudyCoach(args: {
  userId: string;
  problemId: string | null;
  sessionId: string;
  runId: string;
  model: LanguageModel;
  settings: AiRuntimeSettings;
  abortSignal: AbortSignal;
  onTextDelta: (delta: string) => void;
  onStep: (step: AgentStepDto) => void;
  /** "Analyze my attempts": record weak spots server-side before the Coach explains them. */
  analyzeAttempts?: boolean;
  /** A talk-through is active on the problem: this turn opens it (start) or
   *  answers its current question (reply), judged before the Coach replies. */
  practice?: { kind: "start" } | { kind: "reply"; message: string };
  onPractice?: (session: PracticeSessionDto) => void;
}) {
  const runState: {
    navigationStep: AgentStepDto | null;
    startedPractice: boolean;
    /** A first practice's Solutions doc, written alongside this turn. */
    preparing: Promise<PracticeSessionDto | null> | null;
  } = {
    navigationStep: null,
    startedPractice: false,
    preparing: null,
  };
  const prepare = () =>
    prepareTalkReferences({
      userId: args.userId,
      problemId: args.problemId!,
      model: args.model,
      settings: args.settings,
      abortSignal: args.abortSignal,
    });
  await compactAgentSessionIfNeeded({
    userId: args.userId,
    sessionId: args.sessionId,
    model: args.model,
    // Summaries are bookkeeping: keep them fast and cheap.
    callOptions: aiCallOptions(args.settings, "lightest"),
    abortSignal: args.abortSignal,
  });
  const { tools, recordStep } = createStudyCoachTools({
    userId: args.userId,
    problemId: args.problemId,
    runId: args.runId,
    emitStep: (step) => {
      // A reply that only opens a problem or starts practice has no text;
      // the step's summary stands in for it.
      if (step.kind === "navigation" || step.kind === "practice") runState.navigationStep = step;
      if (step.kind === "practice") {
        runState.startedPractice = true;
        if (args.problemId && !runState.preparing) runState.preparing = prepare();
      }
      args.onStep(step);
    },
  });
  const agent = new ToolLoopAgent({
    id: "ankify-study-coach",
    model: args.model,
    instructions: STUDY_COACH_INSTRUCTIONS,
    tools,
    stopWhen: [stepCountIs(8), hasToolCall("open_problem")],
    maxOutputTokens: 4_000,
    ...aiCallOptions(args.settings, "user"),
  });
  const messages: ModelMessage[] = await getAgentModelMessages(args.userId, args.sessionId);
  if (args.analyzeAttempts && args.problemId) {
    const findings = await analyzeAttempts({
      userId: args.userId,
      problemId: args.problemId,
      runId: args.runId,
      model: args.model,
      settings: args.settings,
      abortSignal: args.abortSignal,
    });
    for (const finding of findings) {
      await recordStep({
        kind: "weakness",
        toolName: "analyze_attempts",
        status: "completed",
        summary: finding.weakness.detail,
        weaknessId: finding.weakness.id,
      });
    }
    // The Coach explains what the server recorded; it doesn't record these again.
    const last = messages.at(-1);
    if (last && last.role === "user" && typeof last.content === "string") {
      const content = JSON.parse(last.content) as Record<string, unknown>;
      last.content = JSON.stringify({
        ...content,
        analysisFindings: findings.map(({ weakness, merged }) => ({
          category: weakness.category,
          detail: weakness.detail,
          evidence: weakness.evidence.filter((item) => item.kind === "submission").map((item) => item.ref),
          seenBefore: merged,
        })),
      });
    }
  }
  if (args.practice && args.problemId) {
    // The judge reads the reply first; the Coach gets the decided move as its
    // instruction in this turn's runtimeContext (docs/coach-practice.md, v3).
    const turn =
      args.practice.kind === "start"
        ? await startTalkTurn(args.userId, args.problemId)
        : await judgeTalkTurn({
            userId: args.userId,
            problemId: args.problemId,
            message: args.practice.message,
            model: args.model,
            settings: args.settings,
            abortSignal: args.abortSignal,
          });
    if (turn) {
      args.onPractice?.(turn.session);
      replaceRuntimeContext(messages, (context) => ({ ...context, practiceActive: turn.context }));
    }
    // The Coach asks the first question meanwhile; it needs no doc.
    if (args.practice.kind === "start") runState.preparing = prepare();
  }
  const result = await agent.stream({
    messages,
    abortSignal: args.abortSignal,
    timeout: AGENT_TIMEOUT_MS,
  });

  const text = createStepTextBuffer();
  for await (const part of result.stream) {
    if (part.type === "start-step") {
      text.startStep();
    } else if (part.type === "text-delta") {
      const delta = text.push(part.text);
      if (delta) args.onTextDelta(delta);
    } else if (part.type === "error") {
      throw part.error;
    } else if (part.type === "abort") {
      throw new DOMException("Agent run aborted", "AbortError");
    }
  }
  let content = text.content;
  if (!content.trim()) {
    if (!runState.navigationStep) throw new Error("agent_empty_response");
    content = runState.navigationStep.summary;
  }

  // The turn ends once a first practice's Solutions doc is attached, so the
  // user's first answer is judged against it.
  if (runState.preparing) {
    const prepared = await runState.preparing;
    if (prepared) args.onPractice?.(prepared);
  }

  // What the Coach asked goes in the question's log for the judge.
  if (args.problemId && (args.practice || runState.startedPractice)) {
    await recordTutorLine(args.userId, args.problemId, content);
  }

  const usage = await result.usage;
  const responseMessages = await result.responseMessages;
  return finishAgentRun({
    userId: args.userId,
    sessionId: args.sessionId,
    runId: args.runId,
    content,
    responseMessages,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
}

/** Rewrites the newest user turn's runtimeContext before the model sees it. */
function replaceRuntimeContext(
  messages: ModelMessage[],
  update: (context: Record<string, unknown>) => Record<string, unknown>,
) {
  const last = messages.at(-1);
  if (!last || last.role !== "user" || typeof last.content !== "string") return;
  const content = JSON.parse(last.content) as Record<string, unknown>;
  const context = (content.runtimeContext ?? {}) as Record<string, unknown>;
  last.content = JSON.stringify({ ...content, runtimeContext: update(context) });
}
