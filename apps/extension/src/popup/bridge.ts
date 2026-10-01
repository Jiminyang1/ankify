import type { PageMessage } from "../shared/protocol";

/** Failure codes the background reports (server codes pass through). */
export type BridgeFailure = { ok: false; error: string; session?: unknown };
export type BridgeOutcome<T> = { ok: true; response: T; queued?: false } | { ok: true; queued: true } | BridgeFailure;

/** Sends a validated page message to the background worker, once more if a
 *  starting worker missed it. Not reaching the worker is not a network problem. */
export async function ask<T>(message: PageMessage): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return (await chrome.runtime.sendMessage(message)) as T;
    } catch {
      if (attempt >= 1) return { ok: false, error: "extension_unavailable" } as T;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}
