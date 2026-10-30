import type { OnboardingProgressDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { studyPlanChosenAt } from "./study-plans";

type OnboardingSettings = Omit<OnboardingProgressDto, "complete">;
type OnboardingAiChoice = OnboardingSettings["aiChoice"];

const KEY_ONBOARDING = "onboarding";
const ONBOARDING_ROLLOUT_AT = new Date("2026-07-27T00:00:00+08:00");
/** Choosing a plan became the first step here. Someone who had already
 *  reviewed by then is past the point it helps with, so it doesn't hold
 *  their checklist open. */
const PLAN_STEP_ROLLOUT_AT = new Date("2026-10-30T00:00:00+08:00");

const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettings = {
  aiChoice: "not_started",
};

export function normalizeOnboardingSettings(value: unknown): OnboardingSettings {
  if (!value || typeof value !== "object") return DEFAULT_ONBOARDING_SETTINGS;
  const candidate = value as Partial<OnboardingSettings>;
  const aiChoice: OnboardingAiChoice =
    candidate.aiChoice === "configured" || candidate.aiChoice === "skipped"
      ? candidate.aiChoice
      : "not_started";
  const timestamp = (input: unknown) =>
    typeof input === "string" && !Number.isNaN(Date.parse(input)) ? input : undefined;
  return {
    aiChoice,
    planChosenAt: timestamp(candidate.planChosenAt),
    extensionConnectedAt: timestamp(candidate.extensionConnectedAt),
    aiVerifiedAt: timestamp(candidate.aiVerifiedAt),
    firstCaptureAt: timestamp(candidate.firstCaptureAt),
    firstReviewAt: timestamp(candidate.firstReviewAt),
    completedAt: timestamp(candidate.completedAt),
  };
}

/** Every step handled. The plan step counts only for users whose first
 *  review came after it existed. */
export function onboardingReady(value: OnboardingSettings): boolean {
  if (!value.extensionConnectedAt || !value.firstCaptureAt || !value.firstReviewAt) return false;
  if (value.aiChoice === "not_started") return false;
  return Boolean(value.planChosenAt) || Date.parse(value.firstReviewAt) < PLAN_STEP_ROLLOUT_AT.getTime();
}

export function completeOnboardingWhenReady(
  value: OnboardingSettings,
  now: Date,
): OnboardingSettings {
  if (!value.completedAt && onboardingReady(value)) {
    return { ...value, completedAt: now.toISOString() };
  }
  return value;
}

async function mutateOnboardingSettings(
  userId: string,
  update: (current: OnboardingSettings, now: Date) => OnboardingSettings,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_ONBOARDING)))
      .limit(1);
    const now = new Date();
    const next = completeOnboardingWhenReady(
      update(normalizeOnboardingSettings(row?.value), now),
      now,
    );
    await tx
      .insert(schema.settings)
      .values({ userId, key: KEY_ONBOARDING, value: next })
      .onConflictDoUpdate({
        target: [schema.settings.userId, schema.settings.key],
        set: { value: next, updatedAt: now },
      });
    return next;
  });
}

export async function getOnboardingProgress(userId: string): Promise<OnboardingProgressDto> {
  const db = getDb();
  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_ONBOARDING)))
    .limit(1);
  const stored = normalizeOnboardingSettings(row?.value);
  if (stored.completedAt) {
    return { ...stored, complete: true };
  }

  const [[firstProblem], [firstReview], planSavedAt] = await Promise.all([
    db
      .select({ createdAt: schema.problems.createdAt })
      .from(schema.problems)
      .where(and(eq(schema.problems.userId, userId), isNull(schema.problems.archivedAt)))
      .orderBy(asc(schema.problems.createdAt))
      .limit(1),
    db
      .select({ occurredAt: schema.reviewEvents.occurredAt })
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, userId),
          eq(schema.reviewEvents.eventType, "self_recall_rated"),
          isNull(schema.reviewEvents.undoneAt),
        ),
      )
      .orderBy(asc(schema.reviewEvents.occurredAt))
      .limit(1),
    // A plan switched before this step existed counts as chosen.
    stored.planChosenAt ? null : studyPlanChosenAt(userId),
  ]);

  const planChosenAt = stored.planChosenAt ?? planSavedAt?.toISOString();
  const firstCaptureAt = stored.firstCaptureAt ?? firstProblem?.createdAt.toISOString();
  const firstReviewAt = stored.firstReviewAt ?? firstReview?.occurredAt.toISOString();
  const extensionConnectedAt = stored.extensionConnectedAt ?? firstCaptureAt;
  const legacyComplete =
    firstReview?.occurredAt != null && firstReview.occurredAt < ONBOARDING_ROLLOUT_AT;
  const ready = onboardingReady({
    aiChoice: stored.aiChoice,
    planChosenAt,
    extensionConnectedAt,
    firstCaptureAt,
    firstReviewAt,
  });
  const completedAt =
    stored.completedAt ??
    (legacyComplete ? firstReview.occurredAt.toISOString() : undefined) ??
    (ready ? new Date().toISOString() : undefined);

  const progress: OnboardingProgressDto = {
    ...stored,
    planChosenAt,
    extensionConnectedAt,
    firstCaptureAt,
    firstReviewAt,
    completedAt,
    complete: Boolean(completedAt),
  };
  if (completedAt && !stored.completedAt) {
    const persisted: OnboardingSettings = {
      aiChoice: progress.aiChoice,
      planChosenAt: progress.planChosenAt,
      extensionConnectedAt: progress.extensionConnectedAt,
      aiVerifiedAt: progress.aiVerifiedAt,
      firstCaptureAt: progress.firstCaptureAt,
      firstReviewAt: progress.firstReviewAt,
      completedAt,
    };
    await db
      .insert(schema.settings)
      .values({ userId, key: KEY_ONBOARDING, value: persisted })
      .onConflictDoUpdate({
        target: [schema.settings.userId, schema.settings.key],
        set: { value: persisted, updatedAt: new Date() },
      });
  }
  return progress;
}

/** Called whenever the user saves a plan: onboarding's plan step, the Plan
 *  page's picker, a deep-dive switch, or an imported list. */
export async function markPlanChosen(userId: string) {
  return mutateOnboardingSettings(userId, (current, now) => ({
    ...current,
    planChosenAt: current.planChosenAt ?? now.toISOString(),
  }));
}

export async function markExtensionConnected(userId: string) {
  return mutateOnboardingSettings(userId, (current, now) => ({
    ...current,
    extensionConnectedAt: current.extensionConnectedAt ?? now.toISOString(),
  }));
}

export async function markAiVerified(userId: string) {
  return mutateOnboardingSettings(userId, (current, now) => ({
    ...current,
    aiChoice: "configured",
    aiVerifiedAt: now.toISOString(),
  }));
}

export async function markAiSkipped(userId: string) {
  return mutateOnboardingSettings(userId, (current) => ({
    ...current,
    aiChoice: "skipped",
  }));
}

export async function markFirstCapture(userId: string) {
  return mutateOnboardingSettings(userId, (current, now) => {
    const timestamp = now.toISOString();
    return {
      ...current,
      extensionConnectedAt: current.extensionConnectedAt ?? timestamp,
      firstCaptureAt: current.firstCaptureAt ?? timestamp,
    };
  });
}

export async function markFirstReview(userId: string) {
  return mutateOnboardingSettings(userId, (current, now) => ({
    ...current,
    firstReviewAt: current.firstReviewAt ?? now.toISOString(),
  }));
}
