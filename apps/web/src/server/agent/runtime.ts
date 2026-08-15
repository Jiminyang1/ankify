import {
  hasToolCall,
  stepCountIs,
  ToolLoopAgent,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import type { AgentStepDto } from "@ankify/contracts";
import { compactAgentSessionIfNeeded } from "./compaction";
import { STUDY_COACH_INSTRUCTIONS } from "./prompt";
import { finishAgentRun, getAgentModelMessages } from "./store";
import { createStudyCoachTools } from "./tools";

const AGENT_TIMEOUT_MS = 175_000;

export async function runStudyCoach(args: {
  userId: string;
  problemId: string | null;
  sessionId: string;
  runId: string;
  model: LanguageModel;
  abortSignal: AbortSignal;
  onTextDelta: (delta: string) => void;
  onStep: (step: AgentStepDto) => void;
}) {
  const runState: { navigationStep: AgentStepDto | null } = { navigationStep: null };
  await compactAgentSessionIfNeeded({
    userId: args.userId,
    sessionId: args.sessionId,
    model: args.model,
    abortSignal: args.abortSignal,
  });
  const tools = createStudyCoachTools({
    userId: args.userId,
    problemId: args.problemId,
    runId: args.runId,
    emitStep: (step) => {
      if (step.kind === "navigation") runState.navigationStep = step;
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
  });
  const messages: ModelMessage[] = await getAgentModelMessages(args.userId, args.sessionId);
  const result = await agent.stream({
    messages,
    abortSignal: args.abortSignal,
    timeout: AGENT_TIMEOUT_MS,
  });

  let content = "";
  for await (const part of result.stream) {
    if (part.type === "text-delta") {
      content += part.text;
      args.onTextDelta(part.text);
    } else if (part.type === "error") {
      throw part.error;
    } else if (part.type === "abort") {
      throw new DOMException("Agent run aborted", "AbortError");
    }
  }
  if (!content.trim()) {
    if (!runState.navigationStep) throw new Error("agent_empty_response");
    content = runState.navigationStep.summary;
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
