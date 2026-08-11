import { NextResponse } from "next/server";
import { agentTurnRequestSchema, type AgentStreamEvent } from "@ankify/contracts";
import { getActiveModel } from "@/server/ai";
import { classifyAgentError, logAgentError } from "@/server/agent/errors";
import { runStudyCoach } from "@/server/agent/runtime";
import {
  AgentRequestError,
  beginAgentTurn,
  failAgentRun,
} from "@/server/agent/store";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

export const maxDuration = 240;

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const body = await readJsonBody(req, 20_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const parsed = agentTurnRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
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

  let started: Awaited<ReturnType<typeof beginAgentTurn>>;
  try {
    started = await beginAgentTurn({
      userId: user.id,
      ...parsed.data,
      settings: activeModel.settings,
    });
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
            problemId: parsed.data.context.problemId,
            sessionId: started.session.id,
            runId: started.run.id,
            context: parsed.data.context,
            model: activeModel.model,
            abortSignal: runAbortController.signal,
            onTextDelta: (delta) => emit({ type: "text_delta", delta }),
            onStep: (step) => emit({ type: "step", step }),
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
