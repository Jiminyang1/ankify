import type { QuizAnswer, QuizItem } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { loadDbEnv } from "@ankify/db/client";
import { and, eq } from "drizzle-orm";
import { encryptSecret } from "../src/server/secret-box";
import {
  isQaProfile,
  QA_SESSION_ID,
  QA_SESSION_MAX_AGE_SECONDS,
  QA_SESSION_TOKEN,
  QA_USER_EMAIL,
  QA_USER_ID,
} from "../src/server/qa";

loadDbEnv();

if (!isQaProfile()) {
  throw new Error("qa:seed requires ANKIFY_PROFILE=qa");
}

const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const fromNow = (days: number) => new Date(now.getTime() + days * 86_400_000);

const twoSumQuizItems: QuizItem[] = [
  {
    id: "qa-quiz-two-sum-1",
    question: "哈希表解法为什么能把 Two Sum 的时间复杂度降到 `O(n)`？",
    choices: [
      "每个元素只进行一次均摊 `O(1)` 的查找与插入",
      "数组会自动保持有序",
      "哈希表消除了所有空间开销",
      "只需要比较相邻元素",
    ],
    answerIndex: 0,
    explanation: "遍历时查询补数并记录已见元素，每个元素只处理一次。",
    source: "statement",
    scope: "complexity",
  },
  {
    id: "qa-quiz-two-sum-2",
    question: "为什么应当先查询补数、再把当前元素写入哈希表？",
    choices: [
      "避免同一个下标与自己配对",
      "减少数组长度",
      "保证答案按值排序",
      "避免使用额外空间",
    ],
    answerIndex: 0,
    explanation: "先写入会让 `target = 2 * nums[i]` 时命中当前下标。",
    source: "submission",
    scope: "edge_case",
  },
  {
    id: "qa-quiz-two-sum-3",
    question: "哈希表中最适合保存什么？",
    choices: ["数值到下标的映射", "下标到目标值的映射", "所有数对", "排序后的数组副本"],
    answerIndex: 0,
    explanation: "查询补数后需要立即返回对应的原数组下标。",
    source: "card",
    scope: "implementation",
  },
  {
    id: "qa-quiz-two-sum-4",
    question: "输入 `[3, 3]`、目标值 `6` 时，正确结果是什么？",
    choices: ["`[0, 1]`", "`[0, 0]`", "不存在答案", "必须先去重"],
    answerIndex: 0,
    explanation: "两个相同的值来自不同下标，可以组成合法答案。",
    source: "statement",
    scope: "edge_case",
  },
  {
    id: "qa-quiz-two-sum-5",
    question: "这道题的一遍扫描不变量是什么？",
    choices: [
      "哈希表只包含当前下标之前见过的元素",
      "哈希表始终包含整个数组",
      "当前元素一定属于答案",
      "数组前缀已经排序",
    ],
    answerIndex: 0,
    explanation: "该不变量保证命中的补数来自另一个、且更早的下标。",
    source: "notes",
    scope: "invariant",
  },
];

const twoSumQuizAnswers: QuizAnswer[] = twoSumQuizItems.map((item, index) => ({
  itemId: item.id,
  selectedIndex: index === 1 ? 1 : item.answerIndex,
  correct: index !== 1,
  answeredAt: ago(2).toISOString(),
}));

function qaAiSettings() {
  const provider = process.env.ANKIFY_QA_AI_PROVIDER?.trim();
  const model = process.env.ANKIFY_QA_AI_MODEL?.trim();
  const apiKey = process.env.ANKIFY_QA_AI_API_KEY?.trim();
  const reasoningMode = process.env.ANKIFY_QA_AI_REASONING_MODE?.trim() || "fast";
  const configured = provider || model || apiKey;
  if (!configured) return null;
  if (
    (provider !== "openai" && provider !== "anthropic" && provider !== "deepseek") ||
    !model ||
    !apiKey ||
    (reasoningMode !== "fast" && reasoningMode !== "thinking")
  ) {
    throw new Error(
      "Set ANKIFY_QA_AI_PROVIDER, ANKIFY_QA_AI_MODEL, ANKIFY_QA_AI_API_KEY, and a valid ANKIFY_QA_AI_REASONING_MODE in .env.qa.local",
    );
  }
  return {
    provider,
    model,
    reasoningMode,
    encryptedApiKey: encryptSecret(apiKey),
  };
}

async function main() {
  const db = getDb();
  const [storedAi] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, QA_USER_ID), eq(schema.settings.key, "ai")))
    .limit(1);
  const aiSettings = qaAiSettings() ?? storedAi?.value;

  await db.transaction(async (tx) => {
    await tx.delete(schema.user).where(eq(schema.user.id, QA_USER_ID));

    await tx.insert(schema.user).values({
      id: QA_USER_ID,
      name: "Ankify QA",
      email: QA_USER_EMAIL,
      emailVerified: true,
      createdAt: ago(60),
      updatedAt: now,
    });
    await tx.insert(schema.session).values({
      id: QA_SESSION_ID,
      userId: QA_USER_ID,
      token: QA_SESSION_TOKEN,
      expiresAt: new Date(now.getTime() + QA_SESSION_MAX_AGE_SECONDS * 1000),
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(schema.problems).values([
      {
        id: "qa-problem-two-sum",
        userId: QA_USER_ID,
        leetcodeSlug: "two-sum",
        leetcodeId: 1,
        title: "Two Sum",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/two-sum/",
        descriptionMd:
          "Given an array of integers `nums` and an integer `target`, return indices of the two numbers that add up to `target`.",
        topicTags: ["Array", "Hash Table"],
        similarSlugs: ["three-sum", "two-sum-ii-input-array-is-sorted"],
        notes: "一遍扫描。先查 `target - nums[i]`，再记录当前值，避免同一下标重复使用。",
        fsrsDue: ago(1),
        fsrsStability: 8.5,
        fsrsDifficulty: 4.2,
        fsrsElapsedDays: 9,
        fsrsScheduledDays: 8,
        fsrsLearningSteps: 0,
        fsrsReps: 5,
        fsrsLapses: 1,
        fsrsState: "review",
        fsrsLastReview: ago(9),
        createdAt: ago(45),
        updatedAt: ago(9),
      },
      {
        id: "qa-problem-lru-cache",
        userId: QA_USER_ID,
        leetcodeSlug: "lru-cache",
        leetcodeId: 146,
        title: "LRU Cache",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/lru-cache/",
        descriptionMd:
          "Design a data structure that follows the constraints of a Least Recently Used cache with `O(1)` get and put operations.",
        topicTags: ["Hash Table", "Linked List", "Design"],
        similarSlugs: ["lfu-cache"],
        notes: "哈希表负责定位节点，双向链表维护最近使用顺序。",
        fsrsDue: null,
        fsrsState: "new",
        createdAt: ago(12),
        updatedAt: ago(12),
      },
      {
        id: "qa-problem-binary-search",
        userId: QA_USER_ID,
        leetcodeSlug: "binary-search",
        leetcodeId: 704,
        title: "Binary Search",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/binary-search/",
        descriptionMd: "Given a sorted array and a target, return its index or `-1`.",
        topicTags: ["Array", "Binary Search"],
        similarSlugs: ["search-insert-position"],
        notes: "闭区间模板：循环条件 `left <= right`。",
        fsrsDue: fromNow(3),
        fsrsStability: 18,
        fsrsDifficulty: 2.8,
        fsrsElapsedDays: 4,
        fsrsScheduledDays: 7,
        fsrsLearningSteps: 0,
        fsrsReps: 8,
        fsrsLapses: 0,
        fsrsState: "review",
        fsrsLastReview: ago(4),
        createdAt: ago(35),
        updatedAt: ago(4),
      },
    ]);

    await tx.insert(schema.submissions).values([
      {
        id: "qa-submission-two-sum-wa",
        userId: QA_USER_ID,
        problemId: "qa-problem-two-sum",
        leetcodeSubmissionId: "qa-two-sum-wa",
        language: "typescript",
        code: "const seen = new Map<number, number>();\nfor (let i = 0; i < nums.length; i++) {\n  seen.set(nums[i], i);\n  const j = seen.get(target - nums[i]);\n  if (j !== undefined) return [j, i];\n}\nreturn [];",
        status: "Wrong Answer",
        failedTestcase: "[3,3]\n6",
        expectedOutput: "[0,1]",
        actualOutput: "[0,0]",
        submittedAt: ago(10),
      },
      {
        id: "qa-submission-two-sum-ac",
        userId: QA_USER_ID,
        problemId: "qa-problem-two-sum",
        leetcodeSubmissionId: "qa-two-sum-ac",
        language: "typescript",
        code: "const seen = new Map<number, number>();\nfor (let i = 0; i < nums.length; i++) {\n  const j = seen.get(target - nums[i]);\n  if (j !== undefined) return [j, i];\n  seen.set(nums[i], i);\n}\nreturn [];",
        status: "Accepted",
        runtimeMs: 58,
        memoryKb: 46_100,
        submittedAt: ago(9),
      },
      {
        id: "qa-submission-lru-tle",
        userId: QA_USER_ID,
        problemId: "qa-problem-lru-cache",
        leetcodeSubmissionId: "qa-lru-tle",
        language: "python3",
        code: "class LRUCache:\n    def get(self, key):\n        for item in self.items:\n            if item[0] == key:\n                return item[1]\n        return -1",
        status: "Time Limit Exceeded",
        failedTestcase: "many alternating get/put operations",
        submittedAt: ago(3),
      },
    ]);

    await tx.insert(schema.cards).values([
      {
        id: "qa-card-two-sum-invariant",
        userId: QA_USER_ID,
        problemId: "qa-problem-two-sum",
        question: "Two Sum 一遍哈希扫描的核心不变量是什么？",
        answer: "处理下标 `i` 前，哈希表只保存区间 `[0, i)` 的值到下标映射。",
        aiStatus: "ready",
        createdAt: ago(8),
        updatedAt: ago(8),
      },
      {
        id: "qa-card-two-sum-complexity",
        userId: QA_USER_ID,
        problemId: "qa-problem-two-sum",
        question: "Two Sum 哈希表方案的时间和空间复杂度？",
        answer: "平均时间 `O(n)`，额外空间 `O(n)`。",
        aiStatus: "ready",
        createdAt: ago(7),
        updatedAt: ago(7),
      },
      {
        id: "qa-card-two-sum-candidate",
        userId: QA_USER_ID,
        problemId: "qa-problem-two-sum",
        question: "为什么重复元素不会破坏哈希表解法？",
        answer: "映射保存的是此前元素下标；先查询再插入即可区分两个相同值的不同下标。",
        aiStatus: "candidate",
        createdAt: ago(1),
        updatedAt: ago(1),
      },
      {
        id: "qa-card-binary-search-boundary",
        userId: QA_USER_ID,
        problemId: "qa-problem-binary-search",
        question: "闭区间二分模板的循环条件是什么？",
        answer: "`while (left <= right)`，因为两端都属于尚未排除的搜索区间。",
        aiStatus: "ready",
        createdAt: ago(20),
        updatedAt: ago(20),
      },
    ]);

    await tx.insert(schema.reviewEvents).values([
      {
        id: "qa-event-two-sum-captured",
        userId: QA_USER_ID,
        problemId: "qa-problem-two-sum",
        eventType: "problem_captured",
        occurredAt: ago(45),
      },
      {
        id: "qa-event-two-sum-rated",
        userId: QA_USER_ID,
        problemId: "qa-problem-two-sum",
        eventType: "self_recall_rated",
        fsrsRating: 2,
        requestId: "00000000-0000-4000-8000-000000000001",
        fsrsStabilitySnap: 8.5,
        fsrsDifficultySnap: 4.2,
        fsrsRetrievabilitySnap: 0.82,
        occurredAt: ago(9),
      },
      {
        id: "qa-event-binary-rated",
        userId: QA_USER_ID,
        problemId: "qa-problem-binary-search",
        eventType: "self_recall_rated",
        fsrsRating: 3,
        requestId: "00000000-0000-4000-8000-000000000002",
        fsrsStabilitySnap: 18,
        fsrsDifficultySnap: 2.8,
        fsrsRetrievabilitySnap: 0.94,
        occurredAt: ago(4),
      },
    ]);

    await tx.insert(schema.quizSessions).values({
      id: "qa-quiz-two-sum-archived",
      userId: QA_USER_ID,
      problemId: "qa-problem-two-sum",
      status: "archived",
      itemsJson: twoSumQuizItems,
      answersJson: twoSumQuizAnswers,
      score: 4,
      createdAt: ago(2),
      updatedAt: ago(2),
      completedAt: ago(2),
    });

    const completedAt = ago(3).toISOString();
    await tx.insert(schema.settings).values([
      {
        userId: QA_USER_ID,
        key: "review",
        value: { dailyReviewLimit: 20, timeZone: "Asia/Shanghai" },
      },
      {
        userId: QA_USER_ID,
        key: "generation",
        value: { language: "zh" },
      },
      {
        userId: QA_USER_ID,
        key: "onboarding",
        value: {
          aiChoice: aiSettings ? "configured" : "skipped",
          extensionConnectedAt: completedAt,
          firstCaptureAt: completedAt,
          firstReviewAt: completedAt,
          completedAt,
        },
      },
      ...(aiSettings
        ? [{ userId: QA_USER_ID, key: "ai", value: aiSettings }]
        : []),
    ]);
  });

  console.log("✓ QA database reset with fixed user and deterministic fixtures");
  console.log("  Login: http://localhost:3000/api/qa/login");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
