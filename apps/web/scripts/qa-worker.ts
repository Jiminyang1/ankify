import { getDb, schema } from "@ankify/db";
import { loadDbEnv } from "@ankify/db/client";
import { and, asc, eq, lte } from "drizzle-orm";
import { processAiJob } from "../src/server/ai-generation/runner";
import { isQaProfile } from "../src/server/qa";

loadDbEnv();

if (!isQaProfile()) {
  throw new Error("qa:worker requires ANKIFY_PROFILE=qa");
}

let stopping = false;
let delivery = 0;

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function nextQueuedJobId() {
  const [job] = await getDb()
    .select({ id: schema.aiJobs.id })
    .from(schema.aiJobs)
    .where(
      and(
        eq(schema.aiJobs.status, "queued"),
        lte(schema.aiJobs.runAfter, new Date()),
      ),
    )
    .orderBy(asc(schema.aiJobs.runAfter), asc(schema.aiJobs.createdAt))
    .limit(1);
  return job?.id;
}

async function main() {
  console.log("✓ QA AI worker polling the local database");
  while (!stopping) {
    try {
      const jobId = await nextQueuedJobId();
      if (!jobId) {
        await wait(250);
        continue;
      }
      delivery += 1;
      await processAiJob(jobId, `qa:${process.pid}:${delivery}`);
    } catch (error) {
      // The local database is shared with the dev server, so a read can meet
      // SQLITE_BUSY. Keep polling, as a queue consumer would redeliver.
      console.error("[qa-worker] poll failed; retrying", error instanceof Error ? error.message : error);
      await wait(1_000);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
