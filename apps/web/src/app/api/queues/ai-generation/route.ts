import { handleCallback } from "@vercel/queue";
import { processAiJob } from "@/server/ai-generation/runner";

export const maxDuration = 240;

type AiGenerationMessage = { jobId: string };

class RetryAiJobDelivery extends Error {
  constructor(readonly delaySeconds: number) {
    super("ai_job_retry");
  }
}

const callback = handleCallback<AiGenerationMessage>(
  async (message, metadata) => {
    if (!message || typeof message.jobId !== "string" || !message.jobId) return;
    const result = await processAiJob(
      message.jobId,
      `vqs:${metadata.messageId}:${metadata.deliveryCount}`,
    );
    if (result.state === "retry") throw new RetryAiJobDelivery(result.delaySeconds);
  },
  {
    visibilityTimeoutSeconds: 300,
    retry: (error) => {
      if (error instanceof RetryAiJobDelivery) {
        return { afterSeconds: error.delaySeconds };
      }
      return { afterSeconds: 60 };
    },
  },
);

// The SDK accepts both Request and { request: Request }. App Router handlers
// must expose the narrower Request signature to Next's generated route types.
export async function POST(req: Request) {
  return callback(req);
}
