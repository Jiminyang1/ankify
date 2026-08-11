export function isAiTimeoutError(err: unknown) {
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") return true;
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return err.name === "AbortError" || message.includes("aborted") || message.includes("timeout");
}

export function safeErrorForLog(err: unknown) {
  if (!(err instanceof Error)) return { type: typeof err };
  const details = err as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return {
    name: err.name,
    code:
      typeof details.code === "string" || typeof details.code === "number"
        ? details.code
        : undefined,
    status:
      typeof details.status === "string" || typeof details.status === "number"
        ? details.status
        : typeof details.statusCode === "string" ||
            typeof details.statusCode === "number"
          ? details.statusCode
          : undefined,
  };
}
