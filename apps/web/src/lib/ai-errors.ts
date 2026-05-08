import { NextResponse } from "next/server";

export const AI_TIMEOUT_CODE = "ai_timeout";

export function isAiTimeoutError(err: unknown) {
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") return true;
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return err.name === "AbortError" || message.includes("aborted") || message.includes("timeout");
}

export function aiRouteErrorResponse(
  err: unknown,
  opts: { label: string; timeoutMs: number; logPrefix: string },
) {
  console.error(opts.logPrefix, err);

  if (isAiTimeoutError(err)) {
    const seconds = Math.round(opts.timeoutMs / 1000);
    return NextResponse.json(
      {
        error: AI_TIMEOUT_CODE,
        message: `${opts.label} did not finish within ${seconds} seconds. Try Fast mode in Settings or retry.`,
        retryable: true,
      },
      { status: 504 },
    );
  }

  const message = err instanceof Error ? err.message : `${opts.label} failed`;
  return NextResponse.json({ error: message.slice(0, 1000) }, { status: 500 });
}
