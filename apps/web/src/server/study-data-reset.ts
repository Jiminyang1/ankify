import { getDb, schema } from "@ankify/db";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Settings rows that are study data. A new settings key stays out of a reset
 * until it's added here: `ai`, `review`, and `generation` are the user's setup,
 * `onboarding` keeps them from setting up again, `leetcode-*` mirrors LeetCode
 * and would sync straight back, and `starter-ai-usage` must survive so a reset
 * can't refill free credits.
 */
export const STUDY_SETTINGS_KEYS = [
  "study-plan",
  "custom-study-plans",
  "plan-ticks",
  "technique-suggestions",
  "learner-profile",
] as const;

/**
 * Removes everything the user has studied and keeps the account, so they can
 * start over. Children go first, so this doesn't lean on foreign key cascades.
 */
export async function resetStudyData(userId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(schema.agentSteps).where(eq(schema.agentSteps.userId, userId));
    await tx.delete(schema.agentMessages).where(eq(schema.agentMessages.userId, userId));
    await tx.delete(schema.agentRuns).where(eq(schema.agentRuns.userId, userId));
    await tx.delete(schema.agentSessions).where(eq(schema.agentSessions.userId, userId));
    await tx.delete(schema.aiJobs).where(eq(schema.aiJobs.userId, userId));
    await tx.delete(schema.weaknesses).where(eq(schema.weaknesses.userId, userId));
    await tx.delete(schema.weaknessCategories).where(eq(schema.weaknessCategories.userId, userId));
    await tx.delete(schema.practiceSessions).where(eq(schema.practiceSessions.userId, userId));
    await tx.delete(schema.quizSessions).where(eq(schema.quizSessions.userId, userId));
    await tx.delete(schema.reviewEvents).where(eq(schema.reviewEvents.userId, userId));
    await tx.delete(schema.cards).where(eq(schema.cards.userId, userId));
    await tx.delete(schema.submissions).where(eq(schema.submissions.userId, userId));
    await tx.delete(schema.problems).where(eq(schema.problems.userId, userId));
    await tx
      .delete(schema.settings)
      .where(and(eq(schema.settings.userId, userId), inArray(schema.settings.key, [...STUDY_SETTINGS_KEYS])));
  });
}
