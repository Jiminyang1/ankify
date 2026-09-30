import { after } from "next/server";

/**
 * Runs best-effort work after the response is sent. Outside a request (tests,
 * the QA worker) it runs immediately instead. Failures are logged, never
 * surfaced to the request that scheduled them.
 */
export function afterResponse(task: () => Promise<unknown>) {
  const run = () =>
    task().catch((error: unknown) => {
      console.error("[after-response] task failed", { error: error instanceof Error ? error.name : "unknown" });
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
