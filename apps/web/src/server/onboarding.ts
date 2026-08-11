import type { OnboardingProgressDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, asc, eq, isNull } from "drizzle-orm";

type OnboardingSettings = Omit<OnboardingProgressDto, "complete">;
type OnboardingAiChoice = OnboardingSettings["aiChoice"];

const KEY_ONBOARDING = "onboarding";
const ONBOARDING_ROLLOUT_AT = new Date("2026-07-27T00:00:00+08:00");

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
    extensionConnectedAt: timestamp(candidate.extensionConnectedAt),
    aiVerifiedAt: timestamp(candidate.aiVerifiedAt),
    firstCaptureAt: timestamp(candidate.firstCaptureAt),
    firstReviewAt: timestamp(candidate.firstReviewAt),
    completedAt: timestamp(candidate.completedAt),
  };
}

export function completeOnboardingWhenReady(
  value: OnboardingSettings,
  now: Date,
): OnboardingSettings {
  if (
    !value.completedAt &&
    value.extensionConnectedAt &&
    value.firstCaptureAt &&
    value.firstReviewAt &&
    value.aiChoice !== "not_started"
  ) {
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

  const [[firstProblem], [firstReview]] = await Promise.all([
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
  ]);

  const firstCaptureAt = stored.firstCaptureAt ?? firstProblem?.createdAt.toISOString();
  const firstReviewAt = stored.firstReviewAt ?? firstReview?.occurredAt.toISOString();
  const extensionConnectedAt = stored.extensionConnectedAt ?? firstCaptureAt;
  const legacyComplete =
    firstReview?.occurredAt != null && firstReview.occurredAt < ONBOARDING_ROLLOUT_AT;
  const ready =
    Boolean(extensionConnectedAt && firstCaptureAt && firstReviewAt) &&
    stored.aiChoice !== "not_started";
  const completedAt =
    stored.completedAt ??
    (legacyComplete ? firstReview.occurredAt.toISOString() : undefined) ??
    (ready ? new Date().toISOString() : undefined);

  const progress: OnboardingProgressDto = {
    ...stored,
    extensionConnectedAt,
    firstCaptureAt,
    firstReviewAt,
    completedAt,
    complete: Boolean(completedAt),
  };
  if (completedAt && !stored.completedAt) {
    const persisted: OnboardingSettings = {
      aiChoice: progress.aiChoice,
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
