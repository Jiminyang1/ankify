import {
  DEFAULT_STUDY_PLAN,
  OFFICIAL_STUDY_PLANS,
  findOfficialStudyPlan,
  groupByPattern,
  type LeetCodeDifficulty,
  type StudyPlan,
} from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { leetcodeGraphql } from "./leetcode-graphql";

/**
 * Which study plan the profile shows: one of LeetCode's official plans, or a
 * plan imported from the user's own public LeetCode problem list. Imported
 * plans are stored per user in `settings` (`custom-study-plans`) and use the
 * slug `list:<leetcode list slug>`.
 */

const CURRENT_KEY = "study-plan";
const CUSTOM_KEY = "custom-study-plans";
const CUSTOM_PREFIX = "list:";
export const MAX_CUSTOM_PLANS = 5;
const MAX_LIST_QUESTIONS = 400;
const PAGE_SIZE = 100;

type CustomPlan = StudyPlan & { importedAt: number };

export type StudyPlanOption = { slug: string; name: string; custom: boolean };

export type ImportListError =
  | "invalid_link"
  | "unsupported_site"
  | "not_found"
  | "empty"
  | "too_many_lists"
  | "leetcode_unavailable";

async function readSetting(userId: string, key: string): Promise<unknown> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, key)));
  return row?.value;
}

async function writeSetting(userId: string, key: string, value: unknown) {
  await getDb()
    .insert(schema.settings)
    .values({ userId, key, value })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value, updatedAt: new Date() },
    });
}

async function getCustomPlans(userId: string): Promise<CustomPlan[]> {
  const value = await readSetting(userId, CUSTOM_KEY);
  return Array.isArray(value) ? (value as CustomPlan[]) : [];
}

/** The plan the profile shows, plus every plan the user can switch to. */
export async function getCurrentStudyPlan(userId: string) {
  const [current, custom] = await Promise.all([readSetting(userId, CURRENT_KEY), getCustomPlans(userId)]);
  const slug = (current as { plan?: unknown } | undefined)?.plan;
  const plan =
    findOfficialStudyPlan(slug) ??
    custom.find((candidate) => candidate.slug === slug) ??
    findOfficialStudyPlan(DEFAULT_STUDY_PLAN)!;
  const options: StudyPlanOption[] = [
    ...OFFICIAL_STUDY_PLANS.map((official) => ({ slug: official.slug, name: official.name, custom: false })),
    ...custom.map((imported) => ({ slug: imported.slug, name: imported.name, custom: true })),
  ];
  return { plan, custom: plan.slug.startsWith(CUSTOM_PREFIX), options };
}

/** false when the slug isn't an official plan or one of the user's imports. */
export async function setCurrentStudyPlan(userId: string, slug: string): Promise<boolean> {
  const known = findOfficialStudyPlan(slug) || (await getCustomPlans(userId)).some((plan) => plan.slug === slug);
  if (!known) return false;
  await writeSetting(userId, CURRENT_KEY, { plan: slug });
  return true;
}

export async function removeCustomPlan(userId: string, slug: string) {
  const custom = await getCustomPlans(userId);
  await writeSetting(userId, CUSTOM_KEY, custom.filter((plan) => plan.slug !== slug));
  const current = (await readSetting(userId, CURRENT_KEY)) as { plan?: unknown } | undefined;
  if (current?.plan === slug) await writeSetting(userId, CURRENT_KEY, { plan: DEFAULT_STUDY_PLAN });
}

/** Every problem slug in the plans this user can see, so add-to-review only
 *  accepts problems that are actually on a roadmap. */
export async function studyPlanSlugsForUser(userId: string): Promise<Set<string>> {
  const plans = [...OFFICIAL_STUDY_PLANS, ...(await getCustomPlans(userId))];
  return new Set(plans.flatMap((plan) => plan.groups.flatMap((group) => group.questions.map((q) => q.slug))));
}

const LIST_SLUG_RE = /^[a-z0-9-]{4,64}$/i;

/** Accepts `leetcode.com/problem-list/<slug>/`, the legacy `/list/<slug>/`,
 *  or the bare slug. */
export function parseLeetcodeListLink(input: string): { slug: string } | { error: ImportListError } {
  const raw = input.trim();
  if (!raw) return { error: "invalid_link" };
  if (!/[/.]/.test(raw)) return LIST_SLUG_RE.test(raw) ? { slug: raw } : { error: "invalid_link" };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "invalid_link" };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "leetcode.cn") return { error: "unsupported_site" };
  if (host !== "leetcode.com") return { error: "invalid_link" };
  const [kind, slug] = url.pathname.split("/").filter(Boolean);
  return (kind === "problem-list" || kind === "list") && slug && LIST_SLUG_RE.test(slug)
    ? { slug }
    : { error: "invalid_link" };
}

const LIST_QUERY = `query ankifyList($slug: String!, $skip: Int!, $limit: Int!) {
  favoriteDetailV2(favoriteSlug: $slug) { name }
  favoriteQuestionList(favoriteSlug: $slug, skip: $skip, limit: $limit) {
    hasMore
    questions { questionFrontendId title titleSlug difficulty topicTags { slug } }
  }
}`;

const listPageSchema = z.object({
  data: z.object({
    favoriteDetailV2: z.object({ name: z.string() }).nullable(),
    favoriteQuestionList: z
      .object({
        hasMore: z.boolean(),
        questions: z.array(
          z.object({
            questionFrontendId: z.string(),
            title: z.string(),
            titleSlug: z.string(),
            difficulty: z.string(),
            topicTags: z.array(z.object({ slug: z.string() })),
          }),
        ),
      })
      .nullable(),
  }),
});

const DIFFICULTY: Record<string, LeetCodeDifficulty> = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" };

/** Import a public LeetCode problem list as a plan and switch to it.
 *  Re-importing the same list refreshes it in place. */
export async function importLeetcodeList(
  userId: string,
  input: string,
): Promise<{ plan: StudyPlanOption } | { error: ImportListError }> {
  const parsed = parseLeetcodeListLink(input);
  if ("error" in parsed) return parsed;

  let name: string | null = null;
  const questions: (StudyPlan["groups"][number]["questions"][number] & { tagSlugs: string[] })[] = [];
  try {
    for (let skip = 0; skip < MAX_LIST_QUESTIONS; skip += PAGE_SIZE) {
      const page = listPageSchema.parse(
        await leetcodeGraphql(LIST_QUERY, { slug: parsed.slug, skip, limit: PAGE_SIZE }),
      ).data;
      if (!page.favoriteDetailV2 || !page.favoriteQuestionList) return { error: "not_found" };
      name = page.favoriteDetailV2.name;
      for (const q of page.favoriteQuestionList.questions) {
        const difficulty = DIFFICULTY[q.difficulty.toUpperCase()];
        if (!difficulty) continue;
        questions.push({
          id: Number.parseInt(q.questionFrontendId, 10) || 0,
          slug: q.titleSlug,
          title: q.title,
          difficulty,
          tagSlugs: q.topicTags.map((tag) => tag.slug),
        });
      }
      if (!page.favoriteQuestionList.hasMore) break;
    }
  } catch (error) {
    console.warn("[study-plans] list import failed", error);
    return { error: "leetcode_unavailable" };
  }
  if (questions.length === 0) return { error: "empty" };

  const slug = `${CUSTOM_PREFIX}${parsed.slug}`;
  const custom = await getCustomPlans(userId);
  const existing = custom.findIndex((plan) => plan.slug === slug);
  if (existing < 0 && custom.length >= MAX_CUSTOM_PLANS) return { error: "too_many_lists" };

  const plan: CustomPlan = {
    slug,
    name: name ?? parsed.slug,
    groups: groupByPattern(questions.slice(0, MAX_LIST_QUESTIONS)),
    importedAt: Date.now(),
  };
  const next = existing < 0 ? [...custom, plan] : custom.map((candidate, index) => (index === existing ? plan : candidate));
  await writeSetting(userId, CUSTOM_KEY, next);
  await writeSetting(userId, CURRENT_KEY, { plan: slug });
  return { plan: { slug, name: plan.name, custom: true } };
}
