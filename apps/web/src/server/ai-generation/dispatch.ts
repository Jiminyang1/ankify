import { DuplicateMessageError, send } from "@vercel/queue";
import { isQaProfile } from "@/server/qa";

const AI_GENERATION_TOPIC = "ankify-ai-generation";

export async function dispatchAiJob(jobId: string) {
  if (isQaProfile()) return;

  try {
    await send(
      AI_GENERATION_TOPIC,
      { jobId },
      {
        idempotencyKey: jobId,
        retentionSeconds: 7 * 24 * 60 * 60,
      },
    );
  } catch (error) {
    if (!(error instanceof DuplicateMessageError)) throw error;
  }
}
