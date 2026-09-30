import type { AiJobCreateRequestInput } from "@ankify/contracts";
import type { AiJob } from "@ankify/db";
import { RATE_LIMITS, checkRateLimit } from "@/server/rate-limit";
import { createSessionAnalysisJob } from "@/server/session-analysis/jobs";
import { dispatchAiJob } from "./dispatch";
import {
  AiJobRequestError,
  createAiJob,
  failQueuedAiJob,
  getOwnedAiJobByRequestId,
  markJobDispatched,
} from "./jobs";

export async function startAiJobForUser(
  userId: string,
  input: AiJobCreateRequestInput,
): Promise<AiJob> {
  const existing = await getOwnedAiJobByRequestId(userId, input.requestId);
  if (existing) {
    assertSameRequest(existing, input);
    if (existing.status === "queued" && !existing.dispatchedAt) await publishQueuedJob(existing.id);
    return existing;
  }

  const limit = await checkRateLimit(userId, "ai", RATE_LIMITS.ai);
  if (!limit.ok) {
    throw new AiJobRequestError(
      "rate_limited",
      "Too many AI requests. Please wait before trying again.",
      429,
      limit.retryAfterSec,
    );
  }

  const job =
    input.action === "session_analyze" ? await createSessionAnalysisJob(userId, input) : await createAiJob(userId, input);
  if (job.status === "queued" && !job.dispatchedAt) await publishQueuedJob(job.id);
  return job;
}

/** A request id names one command; reusing it for a different one is a conflict. */
function assertSameRequest(job: AiJob, input: AiJobCreateRequestInput) {
  const same =
    job.action === input.action &&
    (input.action === "session_analyze" ? job.practiceSessionId === input.practiceSessionId : job.problemId === input.problemId);
  if (!same) {
    throw new AiJobRequestError("ai_job_request_conflict", "This request id was already used for a different AI job.", 409);
  }
}

async function publishQueuedJob(jobId: string) {
  try {
    await dispatchAiJob(jobId);
    await markJobDispatched(jobId);
  } catch {
    await failQueuedAiJob(jobId, "queue_publish_failed", "AI queue is temporarily unavailable.");
    throw new AiJobRequestError(
      "queue_publish_failed",
      "AI queue is temporarily unavailable. Try again.",
      503,
    );
  }
}
