import type { LeetcodeAvailability, SessionObservationInput } from "@ankify/contracts";
import { compareSubmissionIds, START_AMBIGUITY_WINDOW_MS } from "@ankify/core";
import type { LeetcodeClient, ListedSubmission } from "./leetcode-client";

/** Detail fetches per submission before it is reported as unavailable. */
export const MAX_DETAIL_ATTEMPTS = 3;

export type PollerSession = {
  baselineState: "pending" | "established" | "none" | "unavailable";
  baselineSubmissionId: string | null;
  startedAt: string;
};

type Known = { detail: "complete" | "pending" | "unavailable"; attempts: number };

const AVAILABILITY_ORDER: LeetcodeAvailability[] = ["available", "partial", "unavailable", "signed_out"];
const worse = (a: LeetcodeAvailability, b: LeetcodeAvailability) =>
  AVAILABILITY_ORDER.indexOf(a) >= AVAILABILITY_ORDER.indexOf(b) ? a : b;

export type PollResult = {
  availability: LeetcodeAvailability;
  reported: number;
  /** New submissions LeetCode is still judging; reported once judged. */
  judging: number;
};

/**
 * Finds the session's new submissions on LeetCode and reports them. Only
 * judged submissions newer than the baseline are reported (or, without a
 * baseline, those around or after the start; the server places them); ones
 * still being judged are counted so the page can show them and check again
 * soon. Each is reported once with its details, or again when late details
 * arrive; after `MAX_DETAIL_ATTEMPTS` failed fetches it is reported as
 * detail-unavailable. Polls never overlap.
 */
export function createSubmissionPoller(deps: {
  client: LeetcodeClient;
  slug: string;
  session: () => PollerSession;
  report: (observations: SessionObservationInput[]) => Promise<void>;
}) {
  const known = new Map<string, Known>();
  let inFlight: Promise<PollResult> | null = null;

  function isCandidate(submission: ListedSubmission, session: PollerSession) {
    if (session.baselineState === "established" && session.baselineSubmissionId) {
      return (compareSubmissionIds(submission.id, session.baselineSubmissionId) ?? 1) > 0;
    }
    if (session.baselineState === "none") return true;
    // Without a baseline, let the server decide around the start time.
    if (!submission.submittedAt) return true;
    return Date.parse(submission.submittedAt) >= Date.parse(session.startedAt) - START_AMBIGUITY_WINDOW_MS;
  }

  async function run(): Promise<PollResult> {
    const session = deps.session();
    const stopAtId = session.baselineState === "established" ? session.baselineSubmissionId : null;
    const listing = await deps.client.listSubmissions(deps.slug, { stopAtId, maxPages: 3 });
    if (!listing.value) return { availability: listing.availability, reported: 0, judging: 0 };
    let availability = listing.availability;
    let judging = 0;

    const observations: SessionObservationInput[] = [];
    // Recorded only after the report is handed off, so a failed hand-off
    // (e.g. a restarting worker) is retried on the next poll.
    const updates = new Map<string, Known>();
    // Oldest first, so the server sees attempts in the order they happened.
    for (const submission of [...listing.value.submissions].reverse()) {
      if (!isCandidate(submission, session)) continue;
      if (submission.pending) {
        judging += 1;
        continue;
      }
      const entry = known.get(submission.id);
      if (entry && entry.detail !== "pending") continue;
      const attempts = (entry?.attempts ?? 0) + 1;
      const detail = await deps.client.readSubmissionDetail(submission.id);
      availability = worse(availability, detail.availability === "available" ? "available" : "partial");
      const base = {
        leetcodeSubmissionId: submission.id,
        verdict: submission.verdict,
        ...(submission.submittedAt ? { submittedAt: submission.submittedAt } : {}),
      };
      if (detail.value) {
        observations.push({ ...base, detail: detail.value });
        updates.set(submission.id, { detail: "complete", attempts });
      } else if (attempts >= MAX_DETAIL_ATTEMPTS) {
        observations.push({ ...base, detailUnavailable: true });
        updates.set(submission.id, { detail: "unavailable", attempts });
      } else {
        // Report the verdict now; details are retried on later polls.
        if (!entry) observations.push(base);
        updates.set(submission.id, { detail: "pending", attempts });
      }
    }
    for (let index = 0; index < observations.length; index += 20) {
      await deps.report(observations.slice(index, index + 20));
    }
    for (const [id, entry] of updates) known.set(id, entry);
    return { availability, reported: observations.length, judging };
  }

  return {
    poll() {
      inFlight ??= run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
