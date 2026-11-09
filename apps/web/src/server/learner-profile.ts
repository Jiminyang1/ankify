import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import {
  applyLearnerProfileEdit,
  parseLearnerProfile,
  type LearnerProfile,
  type LearnerProfileEdit,
} from "@ankify/core";

/** Settings row holding the learner profile (`packages/core/src/learner-profile.ts`). */
const KEY_LEARNER_PROFILE = "learner-profile";

export async function getLearnerProfile(userId: string): Promise<LearnerProfile> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_LEARNER_PROFILE)))
    .limit(1);
  return parseLearnerProfile(row?.value);
}

/** Replaces the doc, as long as nobody changed it since `expectedVersion`. */
export async function saveLearnerProfile(
  userId: string,
  markdown: string,
  expectedVersion: number,
): Promise<{ ok: true; profile: LearnerProfile } | { ok: false; error: "version_conflict" }> {
  const profile = { markdown, version: expectedVersion + 1 };
  const storedVersion = sql`COALESCE(CAST(json_extract(${schema.settings.value}, '$.version') AS INTEGER), 0)`;
  const written =
    expectedVersion === 0
      ? await getDb()
          .insert(schema.settings)
          .values({ userId, key: KEY_LEARNER_PROFILE, value: profile })
          .onConflictDoUpdate({
            target: [schema.settings.userId, schema.settings.key],
            set: { value: profile, updatedAt: new Date() },
            setWhere: sql`${storedVersion} = 0`,
          })
          .returning({ key: schema.settings.key })
      : await getDb()
          .update(schema.settings)
          .set({ value: profile, updatedAt: new Date() })
          .where(
            and(
              eq(schema.settings.userId, userId),
              eq(schema.settings.key, KEY_LEARNER_PROFILE),
              sql`${storedVersion} = ${expectedVersion}`,
            ),
          )
          .returning({ key: schema.settings.key });
  if (written.length === 0) return { ok: false, error: "version_conflict" };
  return { ok: true, profile };
}

/** The Coach's edit: one bullet added, rewritten, or removed. Retries once
 *  when the user saved the doc in between. */
export async function editLearnerProfile(userId: string, edit: LearnerProfileEdit) {
  for (let attempt = 0; ; attempt += 1) {
    const current = await getLearnerProfile(userId);
    const result = applyLearnerProfileEdit(current.markdown, edit);
    if (!result.ok || !result.changed) return result;
    const saved = await saveLearnerProfile(userId, result.markdown, current.version);
    if (saved.ok) return result;
    if (attempt > 0) return { ok: false as const, error: saved.error };
  }
}
