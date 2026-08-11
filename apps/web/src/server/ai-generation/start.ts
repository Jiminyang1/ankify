import type { AiJobCreateRequestInput } from "@ankify/contracts";
import type { AiJob } from "@ankify/db";
import { RATE_LIMITS, checkRateLimit } from "@/server/rate-limit";
import { dispatchAiJob } from "./dispatch";
import {
  AiJobRequestError,
  createAiJob,
  failQueuedAiJob,
  getOwnedAiJobByRequestId,
} from "./jobs";

export async function startAiJobForUser(
  userId: string,
  input: AiJobCreateRequestInput,
): Promise<AiJob> {
  const existing = await getOwnedAiJobByRequestId(userId, input.requestId);
  if (existing) {
    if (existing.status === "queued") await publishQueuedJob(existing.id);
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

  const job = await createAiJob(userId, input);
  if (job.status === "queued") await publishQueuedJob(job.id);
  return job;
}

async function publishQueuedJob(jobId: string) {
  try {
    await dispatchAiJob(jobId);
  } catch {
    await failQueuedAiJob(jobId, "queue_publish_failed", "AI queue is temporarily unavailable.");
    throw new AiJobRequestError(
      "queue_publish_failed",
      "AI queue is temporarily unavailable. Try again.",
      503,
    );
  }
}
