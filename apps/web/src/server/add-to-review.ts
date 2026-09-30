import type { CaptureProblemInput } from "@ankify/contracts";
import { STUDY_PLAN } from "@ankify/core";
import { z } from "zod";
import { captureProblem } from "@/server/capture";
import { leetcodeGraphql } from "@/server/leetcode-graphql";

/**
 * "Add to review" for plan problems solved on LeetCode but not in the deck:
 * capture them from LeetCode's public problem data, without submissions (those
 * need the user's LeetCode login; the extension syncs them on the next visit).
 */

const PLAN_SLUGS = new Set(STUDY_PLAN.groups.flatMap((group) => group.questions.map((q) => q.slug)));
const CONCURRENCY = 4;

const QUESTION_QUERY = `query ankifyQuestion($slug: String!) {
  question(titleSlug: $slug) {
    questionFrontendId title titleSlug difficulty content
    topicTags { slug }
    similarQuestions
  }
}`;

const questionSchema = z.object({
  data: z.object({
    question: z
      .object({
        questionFrontendId: z.string(),
        title: z.string(),
        titleSlug: z.string(),
        difficulty: z.enum(["Easy", "Medium", "Hard"]),
        content: z.string().nullable(),
        topicTags: z.array(z.object({ slug: z.string() })),
        similarQuestions: z.string().nullable(),
      })
      .nullable(),
  }),
});

async function fetchQuestion(slug: string): Promise<CaptureProblemInput | null> {
  const { question } = questionSchema.parse(await leetcodeGraphql(QUESTION_QUERY, { slug })).data;
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
    title: question.title,
    difficulty: question.difficulty,
    url: `https://leetcode.com/problems/${question.titleSlug}/`,
    descriptionMd: question.content ?? "",
    topicTags: question.topicTags.map((tag) => tag.slug),
    similarSlugs,
    submissions: [],
  };
}

export async function addPlanProblemsToReview(
  userId: string,
  slugs: string[],
): Promise<{ added: string[]; failed: string[]; limitReached: boolean }> {
  const queue = [...new Set(slugs)].filter((slug) => PLAN_SLUGS.has(slug));
  const added: string[] = [];
  const failed: string[] = [];
  let limitReached = false;

  const worker = async () => {
    for (let slug = queue.shift(); slug != null && !limitReached; slug = queue.shift()) {
      try {
        const input = await fetchQuestion(slug);
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
