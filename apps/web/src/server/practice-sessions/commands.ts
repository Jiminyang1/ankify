import type {
  CaptureSubmissionInput,
  PracticeSessionCommandInput,
  PracticeSessionCommandResponseDto,
  PracticeSessionStartInput,
  PracticeSessionStartResponseDto,
  PracticeSessionSubmissionsInput,
  PracticeSessionSubmissionsResponseDto,
  SessionBaselineInput,
  SessionObservationOutcome,
} from "@ankify/contracts";
import {
  classifyObservation,
  effectiveRatingDisposition,
  isSessionStale,
  mergeOwnerTiming,
  normalizeClientTime,
  ownershipFor,
  RATING_WINDOW_MS,
  ratingDispositionOnCompletion,
  SESSION_LEASE_MS,
  sessionKindFor,
} from "@ankify/core";
import { getDb, schema, type PracticeSession, type PracticeSessionSubmission, type Problem } from "@ankify/db";
import { and, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { markFirstCapture } from "@/server/onboarding";
import { getReviewSettings } from "@/server/settings";
import { findLeetcodeProblem, upsertLeetcodeProblem } from "@/server/problem-upsert";
import { storeSubmissions } from "@/server/submission-store";
import { payloadDigest } from "./digest";
import { initializeProblemSchedule, undoSessionRating } from "./scheduling";
import { isProblemDue, loadSessionEvidence, toProblemStatusDto, worseCompleteness } from "./dto";
import {
  fail,
  findReplay,
  loadProblem,
  loadSession,
  recordCommand,
  sessionDto,
  updateSession,
  type SessionFailure,
  type SessionPatch,
} from "./store";

type StartResult = { ok: true; response: PracticeSessionStartResponseDto } | SessionFailure;
type CommandResult = { ok: true; response: PracticeSessionCommandResponseDto } | SessionFailure;
type IngestResult = { ok: true; response: PracticeSessionSubmissionsResponseDto } | SessionFailure;

const ps = schema.practiceSessions;

/** Moves control to `token`. A new owner starts its own cumulative timing, so
 *  the previous owner's totals are committed first. */
function claimPatch(session: PracticeSession, token: string, now: Date): SessionPatch {
  return {
    ownerToken: token,
    ownerLeaseExpiresAt: new Date(now.getTime() + SESSION_LEASE_MS),
    status: "active",
    lastActivityAt: now,
    ...(session.ownerToken === token ? {} : foldTimingPatch(session)),
  };
}

function foldTimingPatch(session: PracticeSession): SessionPatch {
  return {
    activeMs: session.activeMs + session.ownerActiveMs,
    observedMs: session.observedMs + session.ownerObservedMs,
    ownerActiveMs: 0,
    ownerObservedMs: 0,
  };
}

function baselinePatch(baseline: SessionBaselineInput): SessionPatch {
  return {
    baselineState: baseline.state,
    baselineSubmissionId: baseline.state === "established" ? baseline.leetcodeSubmissionId : null,
  };
}

/**
 * Starts a practice session, or resumes the problem's open session when it is
 * of the same kind. Idempotent per request id; a changed payload under the
 * same id is a conflict. Creating a session never touches FSRS state.
 */
export async function startPracticeSession(
  userId: string,
  input: PracticeSessionStartInput,
  now = new Date(),
): Promise<StartResult> {
  const { requestId, ...payload } = input;
  const digest = payloadDigest({ command: "start", ...payload });

  const result = await getDb().transaction(async (tx): Promise<StartResult> => {
    const replay = await findReplay(tx, userId, requestId);
    if (replay) {
      if (replay.command !== "start" || replay.payloadDigest !== digest) return fail("request_conflict");
      return { ok: true, response: { ...(replay.response as PracticeSessionStartResponseDto), idempotentReplay: true } };
    }

    // Decide the session kind before writing anything, so a rejected review
    // request never creates or modifies a problem.
    let existing: Problem | null;
    if (input.target.kind === "problem") {
      existing = await loadProblem(tx, userId, input.target.problemId);
      if (!existing) return fail("problem_not_found");
    } else {
      const lookup = await findLeetcodeProblem(tx, userId, input.target.problem);
      if (lookup.kind === "conflict") return fail("duplicate_problem_conflict");
      existing = lookup.kind === "found" ? lookup.problem : null;
    }
    const kind = sessionKindFor(
      input.mode,
      existing ? { enrollment: existing.enrollment, due: isProblemDue({ ...existing, archivedAt: null }, now) } : null,
    );
    if ("error" in kind) return fail(kind.error);

    let problem: Problem;
    let problemCreated = false;
    let unarchived = false;
    if (input.target.kind === "leetcode") {
      const upserted = await upsertLeetcodeProblem(tx, userId, input.target.problem, { enrollment: "awaiting_initial", now });
      if (!upserted.ok) return fail(upserted.error, undefined, upserted.message);
      ({ problem, created: problemCreated, unarchived } = upserted);
    } else {
      problem = existing!;
      if (problem.archivedAt) {
        [problem] = await tx
          .update(schema.problems)
          .set({ archivedAt: null, updatedAt: now })
          .where(and(eq(schema.problems.id, problem.id), eq(schema.problems.userId, userId)))
          .returning() as [Problem];
        unarchived = true;
      }
    }
    const problemDto = toProblemStatusDto(problem, now);
    const respond = async (
      session: PracticeSession,
      extra: Pick<PracticeSessionStartResponseDto, "created" | "supersededSessionIds">,
    ): Promise<PracticeSessionStartResponseDto> => ({
      ok: true,
      session: await sessionDto(tx, userId, session, problem, now, input.ownerToken),
      problem: problemDto,
      problemCreated,
      unarchived,
      idempotentReplay: false,
      ...extra,
    });

    const [open] = await tx
      .select()
      .from(ps)
      .where(and(eq(ps.userId, userId), eq(ps.problemId, problem.id), eq(ps.isOpen, true)))
      .limit(1);
    if (open && isSessionStale(open, now)) {
      // Kept as interrupted history; it no longer blocks a new session.
      await updateSession(tx, userId, open, { isOpen: false, status: "interrupted", ownerLeaseExpiresAt: null }, now);
    } else if (open) {
      const openDto = () => sessionDto(tx, userId, open, problem, now, input.ownerToken);
      if (open.type !== kind.type || open.reviewIntent !== kind.reviewIntent) {
        return fail("open_session_conflict", await openDto());
      }
      if (open.sourceAccount && input.sourceAccount && open.sourceAccount !== input.sourceAccount) {
        return fail("account_mismatch", await openDto());
      }
      if (ownershipFor(open, input.ownerToken, now) === "owned_elsewhere") {
        // Nothing changes; the client offers "Continue here" (takeover).
        return { ok: true, response: await respond(open, { created: false, supersededSessionIds: [] }) };
      }
      const resumed = await updateSession(
        tx,
        userId,
        open,
        {
          ...claimPatch(open, input.ownerToken, now),
          ...(open.baselineState === "pending" && input.baseline ? baselinePatch(input.baseline) : {}),
          ...(open.sourceAccount == null && input.sourceAccount ? { sourceAccount: input.sourceAccount } : {}),
        },
        now,
      );
      const response = await respond(resumed, { created: false, supersededSessionIds: [] });
      await recordCommand(tx, { userId, sessionId: resumed.id, requestId, command: "start", payloadDigest: digest, response }, now);
      return { ok: true, response };
    }

    const ratable = await tx
      .select()
      .from(ps)
      .where(and(eq(ps.userId, userId), eq(ps.problemId, problem.id), inArray(ps.ratingDisposition, ["pending", "deferred"])));
    const live = ratable.filter((session) => {
      const disposition = effectiveRatingDisposition(session, problem.scheduleRevision, now);
      return disposition === "pending" || disposition === "deferred";
    });
    if (live.length > 0 && !input.supersedePendingRating) {
      return fail("rating_pending", await sessionDto(tx, userId, live[0]!, problem, now, input.ownerToken));
    }
    for (const session of ratable) {
      const disposition = effectiveRatingDisposition(session, problem.scheduleRevision, now);
      const next = disposition === "pending" || disposition === "deferred" ? "superseded" : disposition;
      await updateSession(tx, userId, session, { ratingDisposition: next }, now);
    }

    const [created] = await tx
      .insert(ps)
      .values({
        id: nanoid(12),
        userId,
        problemId: problem.id,
        requestId,
        type: kind.type,
        reviewIntent: kind.reviewIntent,
        status: "active",
        isOpen: true,
        scheduleRevisionAtStart: problem.scheduleRevision,
        sourceAccount: input.sourceAccount ?? null,
        ownerToken: input.ownerToken,
        ownerLeaseExpiresAt: new Date(now.getTime() + SESSION_LEASE_MS),
        ...(input.baseline ? baselinePatch(input.baseline) : {}),
        startedAt: now,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const response = await respond(created!, { created: true, supersededSessionIds: live.map((session) => session.id) });
    await recordCommand(tx, { userId, sessionId: created!.id, requestId, command: "start", payloadDigest: digest, response }, now);
    return { ok: true, response };
  });

  if (result.ok && result.response.problemCreated && !result.response.idempotentReplay) {
    await markFirstCapture(userId).catch((error) => {
      console.warn("[onboarding] failed to record first capture", error);
    });
  }
  return result;
}

/** Heartbeats, lifecycle transitions, and rating decisions for one session. */
export async function runSessionCommand(
  userId: string,
  sessionId: string,
  input: PracticeSessionCommandInput,
  now = new Date(),
): Promise<CommandResult> {
  if (input.type === "heartbeat") return heartbeat(userId, sessionId, input, now);
  // Read outside the write transaction; only finishing initial learning uses it.
  const initialReviewDelayHours = input.type === "finish" ? (await getReviewSettings(userId)).initialReviewDelayHours : 0;
  const { requestId, ...payload } = input;
  const digest = payloadDigest({ sessionId, ...payload });

  return getDb().transaction(async (tx): Promise<CommandResult> => {
    const replay = await findReplay(tx, userId, requestId);
    if (replay) {
      if (replay.sessionId !== sessionId || replay.command !== input.type || replay.payloadDigest !== digest) {
        return fail("request_conflict");
      }
      return { ok: true, response: { ...(replay.response as PracticeSessionCommandResponseDto), idempotentReplay: true } };
    }
    const session = await loadSession(tx, userId, sessionId);
    if (!session) return fail("session_not_found");
    let problem = (await loadProblem(tx, userId, session.problemId))!;
    const token = "ownerToken" in input ? input.ownerToken : null;
    const dtoOf = (row: PracticeSession) => sessionDto(tx, userId, row, problem, now, token);
    const stale = isSessionStale(session, now);

    let next: PracticeSession;
    switch (input.type) {
      case "resume":
      case "takeover": {
        if (!session.isOpen) return fail("invalid_transition", await dtoOf(session));
        if (stale) return fail("session_stale", await dtoOf(session));
        if (input.type === "resume" && ownershipFor(session, input.ownerToken, now) === "owned_elsewhere") {
          return fail("not_owner", await dtoOf(session));
        }
        next = await updateSession(tx, userId, session, claimPatch(session, input.ownerToken, now), now);
        break;
      }
      case "set_baseline": {
        if (!session.isOpen) return fail("invalid_transition", await dtoOf(session));
        if (ownershipFor(session, input.ownerToken, now) === "owned_elsewhere") return fail("not_owner", await dtoOf(session));
        if (session.baselineState !== "pending") return fail("baseline_already_set", await dtoOf(session));
        next = await updateSession(tx, userId, session, baselinePatch(input.baseline), now);
        break;
      }
      case "finish": {
        if (!session.isOpen) return fail("invalid_transition", await dtoOf(session));
        if (stale) return fail("session_stale", await dtoOf(session));
        if (ownershipFor(session, input.ownerToken, now) === "owned_elsewhere") return fail("not_owner", await dtoOf(session));
        const evidence = (await loadSessionEvidence(tx, userId, [session.id])).get(session.id);
        const completed = normalizeClientTime(new Date(input.occurredAt), { min: session.startedAt, max: now });
        const disposition = ratingDispositionOnCompletion(session.type);
        next = await updateSession(
          tx,
          userId,
          session,
          {
            ...foldTimingPatch(session),
            status: "completed",
            isOpen: false,
            // Accepted evidence, never the client's claim, makes an outcome accepted.
            outcome: input.result === "unsuccessful" ? "failed" : evidence?.accepted ? "accepted" : "unknown",
            completedAt: completed.at,
            completedAtAdjusted: completed.adjusted,
            completionReceivedAt: now,
            ratingDisposition: disposition,
            ratingExpiresAt: disposition === "pending" ? new Date(completed.at.getTime() + RATING_WINDOW_MS) : null,
            ownerLeaseExpiresAt: null,
            lastActivityAt: now,
            captureCompleteness:
              session.captureCompleteness === "partial" && !evidence?.submissions ? "unavailable" : session.captureCompleteness,
          },
          now,
        );
        if (session.type === "initial_learning") {
          // Any explicit finish completes initial learning; abandoned or
          // interrupted sessions never schedule anything.
          problem = (await initializeProblemSchedule(tx, userId, next, completed.at, initialReviewDelayHours, now)) ?? problem;
        }
        break;
      }
      case "abandon": {
        if (!session.isOpen) return fail("invalid_transition", await dtoOf(session));
        if (ownershipFor(session, input.ownerToken, now) === "owned_elsewhere") return fail("not_owner", await dtoOf(session));
        const ended = normalizeClientTime(new Date(input.occurredAt), { min: session.startedAt, max: now });
        next = await updateSession(
          tx,
          userId,
          session,
          {
            ...foldTimingPatch(session),
            status: "abandoned",
            isOpen: false,
            completedAt: ended.at,
            completedAtAdjusted: ended.adjusted,
            completionReceivedAt: now,
            ratingDisposition: "not_applicable",
            ratingExpiresAt: null,
            ownerLeaseExpiresAt: null,
          },
          now,
        );
        break;
      }
      case "defer_rating":
      case "dismiss_rating": {
        const disposition = effectiveRatingDisposition(session, problem.scheduleRevision, now);
        const allowed = input.type === "defer_rating" ? disposition === "pending" : disposition === "pending" || disposition === "deferred";
        if (!allowed) {
          // Persist an expiry or supersession the read side already reports.
          const current =
            disposition === session.ratingDisposition
              ? session
              : await updateSession(tx, userId, session, { ratingDisposition: disposition }, now);
          return fail("rating_not_pending", await dtoOf(current));
        }
        next = await updateSession(
          tx,
          userId,
          session,
          { ratingDisposition: input.type === "defer_rating" ? "deferred" : "dismissed" },
          now,
        );
        break;
      }
      case "undo_rating": {
        if (session.ratingDisposition !== "submitted") return fail("nothing_to_undo", await dtoOf(session));
        const undone = await undoSessionRating(tx, userId, session, now);
        if (!undone.ok) return fail(undone.error, await dtoOf(session));
        problem = (await loadProblem(tx, userId, session.problemId))!;
        next = (await loadSession(tx, userId, session.id))!;
        break;
      }
    }

    const response: PracticeSessionCommandResponseDto = { ok: true, session: await dtoOf(next), idempotentReplay: false };
    await recordCommand(tx, { userId, sessionId, requestId, command: input.type, payloadDigest: digest, response }, now);
    return { ok: true, response };
  });
}

async function heartbeat(
  userId: string,
  sessionId: string,
  input: Extract<PracticeSessionCommandInput, { type: "heartbeat" }>,
  now: Date,
): Promise<CommandResult> {
  return getDb().transaction(async (tx): Promise<CommandResult> => {
    const session = await loadSession(tx, userId, sessionId);
    if (!session) return fail("session_not_found");
    const problem = (await loadProblem(tx, userId, session.problemId))!;
    const dtoOf = (row: PracticeSession) => sessionDto(tx, userId, row, problem, now, input.ownerToken);
    if (!session.isOpen) return fail("invalid_transition", await dtoOf(session));
    if (isSessionStale(session, now)) return fail("session_stale", await dtoOf(session));
    // Heartbeats renew only the current owner's lease; they never claim.
    if (session.ownerToken !== input.ownerToken) return fail("not_owner", await dtoOf(session));

    const timing = mergeOwnerTiming(session, input, {
      committedObservedMs: session.observedMs,
      startedAt: session.startedAt,
      now,
    });
    const next = await updateSession(
      tx,
      userId,
      session,
      {
        ...timing,
        captureCompleteness:
          input.availability && input.availability !== "available"
            ? worseCompleteness(session.captureCompleteness, "partial")
            : session.captureCompleteness,
        status: "active",
        ownerLeaseExpiresAt: new Date(now.getTime() + SESSION_LEASE_MS),
        lastActivityAt: now,
      },
      now,
    );
    return { ok: true, response: { ok: true, session: await dtoOf(next), idempotentReplay: false } };
  });
}

type ObservationPlan =
  | { kind: "result"; outcome: SessionObservationOutcome; observationId: string | null }
  | { kind: "repeat"; of: number }
  | { kind: "insert"; association: "automatic" | "ambiguous"; detailIndex: number | null; storedSubmissionId: string | null }
  | { kind: "enrich"; row: PracticeSessionSubmission; detailIndex: number }
  | { kind: "mark_unavailable"; row: PracticeSessionSubmission };

/**
 * Records submission observations for a session. Any tab may report; each
 * observation is idempotent by its LeetCode submission id (or client
 * observation id). Details, when present, go through `storeSubmissions()` so
 * identity rules match capture. Observations placed outside the session are
 * not stored; ambiguous ones are stored but are not evidence.
 */
export async function ingestSessionObservations(
  userId: string,
  sessionId: string,
  input: PracticeSessionSubmissionsInput,
  now = new Date(),
  ownerToken: string | null = null,
): Promise<IngestResult> {
  return getDb().transaction(async (tx): Promise<IngestResult> => {
    const session = await loadSession(tx, userId, sessionId);
    if (!session) return fail("session_not_found");
    const problem = (await loadProblem(tx, userId, session.problemId))!;
    const o = schema.practiceSessionSubmissions;

    const lcIds = [...new Set(input.observations.flatMap((item) => (item.leetcodeSubmissionId ? [item.leetcodeSubmissionId] : [])))];
    const clientIds = [...new Set(input.observations.flatMap((item) => (item.clientObservationId ? [item.clientObservationId] : [])))];
    const known = lcIds.length || clientIds.length
      ? await tx
          .select()
          .from(o)
          .where(
            and(
              eq(o.userId, userId),
              or(
                lcIds.length ? and(eq(o.sourceSite, session.sourceSite), inArray(o.leetcodeSubmissionId, lcIds)) : undefined,
                clientIds.length ? inArray(o.clientObservationId, clientIds) : undefined,
              ),
            ),
          )
      : [];
    const byLc = new Map(known.flatMap((row) => (row.leetcodeSubmissionId ? [[row.leetcodeSubmissionId, row] as const] : [])));
    const byClient = new Map(known.flatMap((row) => (row.clientObservationId ? [[row.clientObservationId, row] as const] : [])));
    // Details captured earlier (e.g. by legacy capture) complete an observation
    // at once; an id stored under another problem is a conflict.
    const s = schema.submissions;
    const storedDetails = lcIds.length
      ? await tx
          .select({ id: s.id, problemId: s.problemId, leetcodeSubmissionId: s.leetcodeSubmissionId })
          .from(s)
          .where(and(eq(s.userId, userId), inArray(s.leetcodeSubmissionId, lcIds)))
      : [];
    const detailByLc = new Map(storedDetails.map((row) => [row.leetcodeSubmissionId!, row]));

    const details: CaptureSubmissionInput[] = [];
    const seen = new Map<string, number>();
    const plans: ObservationPlan[] = input.observations.map((item, index) => {
      const key = item.leetcodeSubmissionId ? `lc:${item.leetcodeSubmissionId}` : `client:${item.clientObservationId}`;
      const repeated = seen.get(key);
      if (repeated != null) return { kind: "repeat", of: repeated };
      seen.set(key, index);
      const queueDetail = () => {
        if (!item.detail) return null;
        details.push({
          ...item.detail,
          leetcodeSubmissionId: item.leetcodeSubmissionId,
          status: item.verdict,
          submittedAt: item.submittedAt,
        });
        return details.length - 1;
      };

      const existing = (item.leetcodeSubmissionId && byLc.get(item.leetcodeSubmissionId)) || (item.clientObservationId && byClient.get(item.clientObservationId)) || null;
      if (existing) {
        if (existing.sessionId !== session.id) return { kind: "result", outcome: "conflict", observationId: null };
        if (item.detail && existing.detailStatus !== "complete") return { kind: "enrich", row: existing, detailIndex: queueDetail()! };
        if (item.detailUnavailable && existing.detailStatus === "pending") return { kind: "mark_unavailable", row: existing };
        return { kind: "result", outcome: "duplicate", observationId: existing.id };
      }
      const placement = classifyObservation(session, {
        leetcodeSubmissionId: item.leetcodeSubmissionId ?? null,
        submittedAt: item.submittedAt ? new Date(item.submittedAt) : null,
      });
      if (placement === "outside_session") return { kind: "result", outcome: "outside_session", observationId: null };
      const storedDetail = item.leetcodeSubmissionId ? detailByLc.get(item.leetcodeSubmissionId) : undefined;
      if (storedDetail && storedDetail.problemId !== problem.id) return { kind: "result", outcome: "conflict", observationId: null };
      return {
        kind: "insert",
        association: placement === "in_session" ? "automatic" : "ambiguous",
        detailIndex: queueDetail(),
        storedSubmissionId: storedDetail?.id ?? null,
      };
    });

    const stored = await storeSubmissions(tx, userId, problem.id, details, now);
    const results: PracticeSessionSubmissionsResponseDto["results"] = [];
    let changed = false;
    for (const [index, plan] of plans.entries()) {
      const item = input.observations[index]!;
      const detail = "detailIndex" in plan && plan.detailIndex != null ? stored[plan.detailIndex]! : null;
      if (detail?.kind === "conflict") {
        // The submission is stored under another problem: never reassigned.
        results.push({ index, outcome: "conflict", observationId: null });
        continue;
      }
      const linked =
        detail && (detail.kind === "inserted" || detail.kind === "duplicate")
          ? detail.submissionId
          : plan.kind === "insert"
            ? plan.storedSubmissionId
            : null;
      switch (plan.kind) {
        case "result":
          results.push({ index, outcome: plan.outcome, observationId: plan.observationId });
          break;
        case "repeat":
          results.push({ index, outcome: "duplicate", observationId: results[plan.of]?.observationId ?? null });
          break;
        case "insert": {
          const detailStatus = linked
            ? "complete"
            : detail?.kind === "capacity_blocked"
              ? "capacity_blocked"
              : item.detailUnavailable
                ? "unavailable"
                : "pending";
          const [row] = await tx
            .insert(o)
            .values({
              id: nanoid(12),
              userId,
              sessionId: session.id,
              problemId: problem.id,
              sourceSite: session.sourceSite,
              leetcodeSubmissionId: item.leetcodeSubmissionId ?? null,
              clientObservationId: item.clientObservationId ?? null,
              submissionId: linked,
              verdict: item.verdict,
              submittedAt: item.submittedAt ? new Date(item.submittedAt) : null,
              firstObservedAt: now,
              detailStatus,
              association: plan.association,
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: o.id });
          changed = true;
          results.push({
            index,
            outcome:
              plan.association === "ambiguous"
                ? "ambiguous"
                : detailStatus === "capacity_blocked"
                  ? "capacity_blocked"
                  : detailStatus === "complete"
                    ? "recorded"
                    : "recorded_pending_detail",
            observationId: row!.id,
          });
          break;
        }
        case "enrich": {
          const detailStatus = linked ? "complete" : "capacity_blocked";
          await tx
            .update(o)
            .set({ submissionId: linked ?? plan.row.submissionId, detailStatus, updatedAt: now })
            .where(and(eq(o.id, plan.row.id), eq(o.userId, userId)));
          changed = true;
          results.push({ index, outcome: linked ? "enriched" : "capacity_blocked", observationId: plan.row.id });
          break;
        }
        case "mark_unavailable":
          await tx
            .update(o)
            .set({ detailStatus: "unavailable", updatedAt: now })
            .where(and(eq(o.id, plan.row.id), eq(o.userId, userId)));
          changed = true;
          results.push({ index, outcome: "duplicate", observationId: plan.row.id });
          break;
      }
    }

    const next = changed
      ? await updateSession(tx, userId, session, session.isOpen ? { lastActivityAt: now } : {}, now)
      : session;
    return {
      ok: true,
      response: { ok: true, session: await sessionDto(tx, userId, next, problem, now, ownerToken), results },
    };
  });
}
