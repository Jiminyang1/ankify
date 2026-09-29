import { generateText, Output, tool } from "ai";
import { z } from "zod";
import type { AiProvider } from "@ankify/core";
import { buildModel } from "./ai";
import { aiCallOptions } from "./ai/call-options";
import { classifyProviderFailure } from "./ai/errors";
import { safeErrorForLog } from "./ai-errors";
import { markAiVerified } from "./onboarding";
import { decryptSecret } from "./secret-box";
import { getAiSettings, setAiSettings } from "./settings";

const probeSchema = z.object({ ok: z.literal(true) });

type TestAiConnectionInput = {
  provider?: Exclude<AiProvider, "">;
  model?: string;
  apiKey?: string;
  saveOnSuccess?: boolean;
};

type MissingConfigurationResult = {
  ok: false;
  code: "missing_provider" | "missing_model" | "missing_api_key";
};

type TestAiConnectionResult =
  | MissingConfigurationResult
  | {
      ok: true;
      provider: Exclude<AiProvider, "">;
      model: string;
      saved: boolean;
      latencyMs: number;
    }
  | {
      ok: false;
      code: string;
      message: string;
      provider: Exclude<AiProvider, "">;
      model: string;
      latencyMs: number;
    };

export async function testAiConnection(
  userId: string,
  input: TestAiConnectionInput,
): Promise<TestAiConnectionResult> {
  const stored = await getAiSettings(userId);
  const provider = input.provider ?? (stored.provider || undefined);
  const model = input.model ?? (stored.model || undefined);
  const apiKey =
    input.apiKey ??
    (provider === stored.provider && stored.encryptedApiKey
      ? safeDecrypt(stored.encryptedApiKey)
      : undefined);

  if (!provider) return { ok: false, code: "missing_provider" };
  if (!model) return { ok: false, code: "missing_model" };
  if (!apiKey) return { ok: false, code: "missing_api_key" };

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 175_000);

  try {
    const llm = buildModel({ provider, model, apiKey });
    // The probe only checks reachability, so it uses the lightest reasoning the
    // model accepts. No sampling params: newer models reject them.
    const probeOptions = aiCallOptions({ provider, model, reasoningLevel: "default" }, "lightest");
    await generateText({
      model: llm,
      output: Output.object({ schema: probeSchema }),
      system: "You are a connection probe. Respond with {\"ok\": true}.",
      prompt: 'Respond with the JSON object {"ok": true} and nothing else.',
      ...probeOptions,
      abortSignal: controller.signal,
    });
    const toolProbe = await generateText({
      model: llm,
      prompt: "Call confirm_connection with ok=true.",
      tools: {
        confirm_connection: tool({
          description: "Confirm that this model supports tool calling.",
          inputSchema: probeSchema,
          execute: async ({ ok }) => ({ ok }),
        }),
      },
      // Forced tool choice is a 400 on current Claude models, so ask via the prompt.
      toolChoice: "auto",
      ...probeOptions,
      abortSignal: controller.signal,
    });
    if (toolProbe.toolResults.length < 1) throw new Error("tool_call_not_supported");

    if (input.saveOnSuccess) {
      await setAiSettings(userId, {
        provider,
        model,
        reasoningLevel: provider === stored.provider ? stored.reasoningLevel : undefined,
        apiKey: input.apiKey,
      });
      await markAiVerified(userId);
    } else if (
      input.apiKey === undefined &&
      provider === stored.provider &&
      model === stored.model &&
      stored.encryptedApiKey
    ) {
      await markAiVerified(userId);
    }

    return {
      ok: true,
      provider,
      model,
      saved: Boolean(input.saveOnSuccess),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.warn("[ai-test] provider probe failed", safeErrorForLog(error));
    return {
      ok: false,
      ...classifyAiError(error),
      provider,
      model,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function safeDecrypt(
  envelope: NonNullable<Awaited<ReturnType<typeof getAiSettings>>["encryptedApiKey"]>,
) {
  try {
    return decryptSecret(envelope);
  } catch {
    return undefined;
  }
}

const PROBE_FAILURE_MESSAGES = {
  invalid_api_key: "API key was rejected by the provider.",
  forbidden: "API key does not have access to this model.",
  model_not_found: "Model id was not recognized by the provider.",
  quota_or_rate_limit: "Provider returned a rate limit or quota error.",
  timeout: "Provider did not respond within 3 minutes.",
  network: "Could not reach the provider.",
  unknown: "The provider rejected the test or returned an unexpected response.",
} as const;

function classifyAiError(error: unknown): { code: keyof typeof PROBE_FAILURE_MESSAGES; message: string } {
  const failure = classifyProviderFailure(error);
  const code =
    failure === "rate_limited" || failure === "quota_exceeded"
      ? "quota_or_rate_limit"
      : failure === "invalid_api_key" ||
          failure === "forbidden" ||
          failure === "model_not_found" ||
          failure === "timeout" ||
          failure === "network"
        ? failure
        : "unknown";
  return { code, message: PROBE_FAILURE_MESSAGES[code] };
}
