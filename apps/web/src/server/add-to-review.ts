import type { CaptureProblemInput } from "@ankify/contracts";
import { leetcodeProblemUrl, type LeetcodeSite } from "@ankify/core";
import { planCatalogProblem } from "@ankify/core/plan-catalog";
import { z } from "zod";
import { captureProblem } from "@/server/capture";
import { getPreferredLeetcodeSite } from "@/server/leetcode-account";
import { leetcodeGraphql } from "@/server/leetcode-graphql";
import { studyPlanSlugsForUser } from "@/server/study-plans";

/**
 * "Add to review" for plan problems solved on LeetCode but not in the deck:
 * capture them from LeetCode's public problem data, without submissions (those
 * need the user's LeetCode login; the extension syncs them on the next visit).
 * A problem only on leetcode.cn comes from there; any other comes from the site
 * the user's links open on, with its statement in that site's language.
 */

const CONCURRENCY = 4;

const QUESTION_QUERY = `query ankifyQuestion($slug: String!) {
  question(titleSlug: $slug) {
    questionFrontendId title titleSlug difficulty content
    topicTags { slug }
    similarQuestions
  }
}`;

const CN_QUESTION_QUERY = QUESTION_QUERY.replace("content\n", "content translatedTitle translatedContent\n");

const questionSchema = z.object({
  data: z.object({
    question: z
      .object({
        questionFrontendId: z.string(),
        title: z.string(),
        titleSlug: z.string(),
        difficulty: z.enum(["Easy", "Medium", "Hard"]),
        content: z.string().nullable(),
        translatedTitle: z.string().nullable().optional(),
        translatedContent: z.string().nullable().optional(),
        topicTags: z.array(z.object({ slug: z.string() })),
        similarQuestions: z.string().nullable(),
      })
      .nullable(),
  }),
});

async function fetchQuestion(slug: string, site: LeetcodeSite): Promise<CaptureProblemInput | null> {
  const { question } = questionSchema.parse(
    site === "cn"
      ? await leetcodeGraphql(CN_QUESTION_QUERY, { slug }, "cn")
      : await leetcodeGraphql(QUESTION_QUERY, { slug }),
  ).data;
  if (!question) return null;
  let similarSlugs: string[] = [];
  try {
    similarSlugs = (JSON.parse(question.similarQuestions ?? "[]") as { titleSlug: string }[]).map((q) => q.titleSlug);
  } catch {
    /* LeetCode sends this as a JSON-encoded string, sometimes empty */
  }
  return {
    leetcodeSlug: question.titleSlug,
    leetcodeId: Number.parseInt(question.questionFrontendId, 10) || undefined,
    title: question.translatedTitle || question.title,
    difficulty: question.difficulty,
    url: leetcodeProblemUrl(question.titleSlug, site),
    descriptionMd: question.translatedContent || (question.content ?? ""),
    topicTags: question.topicTags.map((tag) => tag.slug),
    similarSlugs,
    submissions: [],
  };
}

export async function addPlanProblemsToReview(
  userId: string,
  slugs: string[],
): Promise<{ added: string[]; failed: string[]; limitReached: boolean }> {
  const [planSlugs, preferredSite] = await Promise.all([
    studyPlanSlugsForUser(userId),
    getPreferredLeetcodeSite(userId),
  ]);
  const queue = [...new Set(slugs)].filter((slug) => planSlugs.has(slug));
  const added: string[] = [];
  const failed: string[] = [];
  let limitReached = false;

  const worker = async () => {
    for (let slug = queue.shift(); slug != null && !limitReached; slug = queue.shift()) {
      try {
        const input = await fetchQuestion(slug, planCatalogProblem(slug)?.cnOnly ? "cn" : preferredSite);
        if (!input) {
          failed.push(slug);
          continue;
        }
        const result = await captureProblem(userId, input);
        if ("error" in result) {
          if (result.error === "problem_limit_reached") limitReached = true;
          failed.push(slug);
        } else {
          added.push(slug);
        }
      } catch (error) {
        console.warn("[add-to-review] failed", slug, error);
        failed.push(slug);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { added, failed, limitReached };
}
