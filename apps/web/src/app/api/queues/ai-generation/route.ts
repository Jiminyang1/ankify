import { handleCallback } from "@vercel/queue";
import { processAiJob } from "@/server/ai-generation/runner";

export const maxDuration = 240;

type AiGenerationMessage = { jobId: string };

class RetryAiJobDelivery extends Error {
  constructor(readonly delaySeconds: number) {
    super("ai_job_retry");
  }
}

export const POST = handleCallback<AiGenerationMessage>(
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
