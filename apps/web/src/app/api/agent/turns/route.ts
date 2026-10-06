import { NextResponse } from "next/server";
import { agentTurnRequestSchema, type AgentStreamEvent } from "@ankify/contracts";
import { buildModel, getActiveModel } from "@/server/ai";
import { applyModelChoice } from "@/server/ai/model-choice";
import { consumeStarterAiCredit, StarterCreditsExhaustedError } from "@/server/starter-ai";
import { classifyAgentError, logAgentError } from "@/server/agent/errors";
import { runStudyCoach } from "@/server/agent/runtime";
import {
  AgentRequestError,
  beginAgentTurn,
  failAgentRun,
} from "@/server/agent/store";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { getActiveTalkContext, getPracticeDebrief, markPracticeDebriefed } from "@/server/practice";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

export const maxDuration = 240;

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  // Room for a 12k-character message plus a 20k-character editor snapshot.
  const body = await readJsonBody(req, 64_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const parsed = agentTurnRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  // Practice results come from the server, never from the client.
  const trigger = parsed.data.trigger;
  let context = { ...parsed.data.context, practice: undefined, practiceActive: undefined } as typeof parsed.data.context;
  if (trigger?.type === "practice_completed") {
    const debrief = await getPracticeDebrief(user.id, trigger.practiceSessionId!);
    if (!debrief) {
      return NextResponse.json({ error: "practice_not_completed", message: "Finish the practice session first." }, { status: 409 });
    }
    const { problemId, ...practice } = debrief;
    context = { ...context, problemId, practice };
  }
  // A talk-through in progress on this problem rides along with every turn.
  if (context.problemId) {
    const active = await getActiveTalkContext(user.id, context.problemId);
    if (active) context = { ...context, practiceActive: active };
  }
  if (trigger?.type === "analyze_attempts" && !context.problemId) {
    return NextResponse.json({ error: "problem_not_saved", message: "Add this problem to ankify first." }, { status: 400 });
  }
  if (trigger?.type === "practice_start" && context.practiceActive?.practiceSessionId !== trigger.practiceSessionId) {
    return NextResponse.json({ error: "practice_not_active", message: "That practice session isn't active." }, { status: 409 });
  }

  const limit = await checkRateLimit(user.id, "agent", RATE_LIMITS.agent);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  let activeModel: Awaited<ReturnType<typeof getActiveModel>>;
  try {
    activeModel = await getActiveModel(user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("AI_NOT_CONFIGURED")) {
      return NextResponse.json({ error: "ai_not_configured", message: message.slice(19) }, { status: 400 });
    }
    if (message.startsWith("AI_KEY_MISSING")) {
      return NextResponse.json({ error: "ai_key_missing", message: message.slice(16) }, { status: 400 });
    }
    throw error;
  }
  if (parsed.data.model) {
    const settings = applyModelChoice(activeModel.settings, parsed.data.model);
    if (settings !== activeModel.settings) activeModel = { settings, model: buildModel(settings) };
  }

  if (activeModel.settings.source === "starter") {
    try {
      await consumeStarterAiCredit(user.id, activeModel.settings.starterLimit ?? 0);
    } catch (error) {
      if (error instanceof StarterCreditsExhaustedError) {
        return NextResponse.json({ error: error.code, message: error.message }, { status: 403 });
      }
      throw error;
    }
  }

  let started: Awaited<ReturnType<typeof beginAgentTurn>>;
  try {
    started = await beginAgentTurn({
      userId: user.id,
      sessionId: parsed.data.sessionId,
      requestId: parsed.data.requestId,
      message: parsed.data.message,
      context,
      settings: activeModel.settings,
    });
    if (trigger?.type === "practice_completed") await markPracticeDebriefed(user.id, trigger.practiceSessionId!);
  } catch (error) {
    if (error instanceof AgentRequestError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }

  const encoder = new TextEncoder();
  const runAbortController = new AbortController();
  const abortRun = () => runAbortController.abort();
  req.signal.addEventListener("abort", abortRun, { once: true });
  if (req.signal.aborted) abortRun();
  let streamClosed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: AgentStreamEvent) => {
        if (streamClosed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      emit({
        type: "run_started",
        session: started.session,
        run: started.run,
        message: started.message,
      });
      void (async () => {
        try {
          const completed = await runStudyCoach({
            userId: user.id,
            problemId: context.problemId,
            sessionId: started.session.id,
            runId: started.run.id,
            model: activeModel.model,
            settings: activeModel.settings,
            abortSignal: runAbortController.signal,
            onTextDelta: (delta) => emit({ type: "text_delta", delta }),
            onStep: (step) => emit({ type: "step", step }),
            analyzeAttempts: trigger?.type === "analyze_attempts",
          });
          emit({ type: "done", ...completed });
        } catch (error) {
          logAgentError(started.run.id, error);
          const failure = classifyAgentError(error);
          const run = await failAgentRun({
            userId: user.id,
            runId: started.run.id,
            ...failure,
          });
          emit({ type: "error", run, message: failure.message });
        } finally {
          req.signal.removeEventListener("abort", abortRun);
          if (!streamClosed) {
            streamClosed = true;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      streamClosed = true;
      runAbortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
