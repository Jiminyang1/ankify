import type { PageMessage } from "../shared/protocol";

/** Failure codes the background reports (server codes pass through). */
export type BridgeFailure = { ok: false; error: string; session?: unknown };
export type BridgeOutcome<T> = { ok: true; response: T; queued?: false } | { ok: true; queued: true } | BridgeFailure;

/** Sends a validated page message to the background worker. */
export async function ask<T>(message: PageMessage): Promise<T> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return { ok: false, error: "offline" } as T;
  }
}
