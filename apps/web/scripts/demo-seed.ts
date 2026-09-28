/**
 * English demo deck for README / landing-page screenshots.
 *
 * Runs against the isolated QA database and reuses the fixed QA login, so
 * `pnpm demo:reset` then http://localhost:3000/api/qa/login gives a realistic,
 * lived-in account. `pnpm qa:reset` restores the regular QA fixtures.
 *
 * Problem statements are short paraphrases written for this demo, not copies
 * of LeetCode text.
 */
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
  throw new Error("demo:seed requires ANKIFY_PROFILE=qa");
}

const DAY = 86_400_000;
const now = new Date();
const at = (daysFromNow: number) => new Date(now.getTime() + daysFromNow * DAY);

// Deterministic PRNG so every reset produces the same charts.
let seed = 20260926;
function rand() {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
}

type Difficulty = "Easy" | "Medium" | "Hard";
type State = "new" | "learning" | "review" | "relearning";

type DemoProblem = {
  slug: string;
  id: number;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  statement: string;
  notes?: string;
  state: State;
  /** Days until due (negative = overdue). Ignored for `new`. */
  due?: number;
  stability?: number;
  difficultyScore?: number;
  reps?: number;
  lapses?: number;
  capturedDaysAgo: number;
  cards?: [string, string][];
};

const problems: DemoProblem[] = [
  {
    slug: "coin-change",
    id: 322,
    title: "Coin Change",
    difficulty: "Medium",
    tags: ["Array", "Dynamic Programming", "Breadth-First Search"],
    statement: [
      "You are given an array `coins` of distinct coin denominations and an integer `amount`.",
      "",
      "Return the **fewest** number of coins needed to make up `amount`. If no combination of coins adds up to `amount`, return `-1`. You have an unlimited supply of every denomination.",
      "",
      "**Example 1**",
      "",
      "```text",
      "Input:  coins = [1, 2, 5], amount = 11",
      "Output: 3",
      "Why:    11 = 5 + 5 + 1",
      "```",
      "",
      "**Example 2**",
      "",
      "```text",
      "Input:  coins = [2], amount = 3",
      "Output: -1",
      "```",
      "",
      "**Example 3**",
      "",
      "```text",
      "Input:  coins = [1], amount = 0",
      "Output: 0",
      "```",
      "",
      "**Constraints**",
      "",
      "- `1 <= coins.length <= 12`",
      "- `1 <= coins[i] <= 2^31 - 1`",
      "- `0 <= amount <= 10^4`",
    ].join("\n"),
    notes: [
      "Greedy (largest coin first) is **wrong** — `[1, 3, 4]`, amount `6` gives 4+1+1 instead of 3+3.",
      "",
      "Unbounded knapsack: `dp[x] = min(dp[x], dp[x - c] + 1)`, `dp[0] = 0`, everything else starts at `amount + 1` as infinity.",
    ].join("\n"),
    state: "relearning",
    due: -1.6,
    stability: 1.9,
    difficultyScore: 7.1,
    reps: 6,
    lapses: 2,
    capturedDaysAgo: 41,
    cards: [
      [
        "Why does largest-coin-first greedy fail on Coin Change?",
        "Denominations aren't canonical. With `coins = [1, 3, 4]` and `amount = 6`, greedy picks `4 + 1 + 1` (3 coins) while `3 + 3` uses 2.",
      ],
      [
        "What sentinel should `dp` start with, and why not `Infinity`?",
        "`amount + 1` — no answer can use more than `amount` coins, it stays an integer, and `dp[amount] > amount` means unreachable → return `-1`.",
      ],
    ],
  },
  {
    slug: "task-scheduler",
    id: 621,
    title: "Task Scheduler",
    difficulty: "Medium",
    tags: ["Array", "Hash Table", "Greedy", "Heap (Priority Queue)"],
    statement:
      "Given CPU `tasks` labeled `A`–`Z` and a cooldown `n`, identical tasks must be at least `n` intervals apart. Return the minimum number of intervals needed to finish every task, counting idle slots.",
    notes: "Answer is `max(len(tasks), (maxFreq - 1) * (n + 1) + countOfMaxFreq)`.",
    state: "review",
    due: -0.8,
    stability: 6.2,
    difficultyScore: 6.4,
    reps: 5,
    lapses: 1,
    capturedDaysAgo: 38,
    cards: [
      [
        "Closed-form answer for Task Scheduler?",
        "`max(n_tasks, (f_max - 1) * (n + 1) + k)` where `k` is how many tasks share the max frequency.",
      ],
    ],
  },
  {
    slug: "longest-substring-without-repeating-characters",
    id: 3,
    title: "Longest Substring Without Repeating Characters",
    difficulty: "Medium",
    tags: ["Hash Table", "String", "Sliding Window"],
    statement:
      "Given a string `s`, return the length of the longest substring that contains no repeated characters.",
    notes: "Jump `left` to `max(left, last[c] + 1)` — never move it backwards.",
    state: "review",
    due: -0.4,
    stability: 9.8,
    difficultyScore: 5.2,
    reps: 5,
    lapses: 0,
    capturedDaysAgo: 52,
    cards: [
      [
        "Why `max(left, last[c] + 1)` instead of `last[c] + 1`?",
        "The last occurrence may already be left of the window; jumping to it would move `left` backwards and re-admit a duplicate.",
      ],
    ],
  },
  {
    slug: "course-schedule",
    id: 207,
    title: "Course Schedule",
    difficulty: "Medium",
    tags: ["Depth-First Search", "Breadth-First Search", "Graph", "Topological Sort"],
    statement:
      "There are `numCourses` courses and a list of prerequisite pairs `[a, b]` meaning `b` must be taken before `a`. Return `true` if every course can be finished.",
    notes: "Kahn's algorithm: finished == numCourses. Equivalent to 'no cycle'.",
    state: "review",
    due: -0.2,
    stability: 11.5,
    difficultyScore: 5.6,
    reps: 4,
    lapses: 0,
    capturedDaysAgo: 30,
  },
  {
    slug: "merge-intervals",
    id: 56,
    title: "Merge Intervals",
    difficulty: "Medium",
    tags: ["Array", "Sorting"],
    statement:
      "Given an array of `intervals`, merge every overlapping pair and return the non-overlapping intervals that cover the same ranges.",
    state: "review",
    due: -0.1,
    stability: 14.2,
    difficultyScore: 4.1,
    reps: 5,
    lapses: 0,
    capturedDaysAgo: 49,
  },
  {
    slug: "word-break",
    id: 139,
    title: "Word Break",
    difficulty: "Medium",
    tags: ["Hash Table", "String", "Dynamic Programming", "Trie"],
    statement:
      "Given a string `s` and a dictionary `wordDict`, return `true` if `s` can be split into a sequence of one or more dictionary words.",
    notes: "`dp[i]` = prefix of length i is breakable. Only check `j >= i - maxWordLen`.",
    state: "learning",
    due: -0.05,
    stability: 1.2,
    difficultyScore: 6.8,
    reps: 2,
    lapses: 0,
    capturedDaysAgo: 3,
  },
  {
    slug: "trapping-rain-water",
    id: 42,
    title: "Trapping Rain Water",
    difficulty: "Hard",
    tags: ["Array", "Two Pointers", "Dynamic Programming", "Stack"],
    statement:
      "Given `n` non-negative integers representing an elevation map with bars of width 1, compute how much water is trapped after raining.",
    notes: "Two pointers: move the side with the smaller max — its water level is already decided.",
    state: "review",
    due: 0.6,
    stability: 4.8,
    difficultyScore: 7.8,
    reps: 6,
    lapses: 2,
    capturedDaysAgo: 55,
  },
  {
    slug: "lru-cache",
    id: 146,
    title: "LRU Cache",
    difficulty: "Medium",
    tags: ["Hash Table", "Linked List", "Design", "Doubly-Linked List"],
    statement:
      "Design a Least Recently Used cache with `get(key)` and `put(key, value)` that both run in `O(1)` average time, evicting the least recently used key when capacity is exceeded.",
    notes: "Hash map → node, doubly linked list keeps recency. Sentinel head/tail removes edge cases.",
    state: "review",
    due: 1.4,
    stability: 8.3,
    difficultyScore: 6.0,
    reps: 4,
    lapses: 1,
    capturedDaysAgo: 34,
  },
  {
    slug: "number-of-islands",
    id: 200,
    title: "Number of Islands",
    difficulty: "Medium",
    tags: ["Array", "Depth-First Search", "Breadth-First Search", "Union Find", "Matrix"],
    statement:
      "Given an `m x n` grid of `'1'` (land) and `'0'` (water), return the number of islands formed by horizontally or vertically adjacent land.",
    state: "review",
    due: 2.3,
    stability: 21,
    difficultyScore: 3.4,
    reps: 6,
    lapses: 0,
    capturedDaysAgo: 58,
  },
  {
    slug: "kth-largest-element-in-an-array",
    id: 215,
    title: "Kth Largest Element in an Array",
    difficulty: "Medium",
    tags: ["Array", "Divide and Conquer", "Sorting", "Heap (Priority Queue)", "Quickselect"],
    statement: "Return the `k`th largest element of `nums` without fully sorting the array.",
    state: "review",
    due: 3.1,
    stability: 12.4,
    difficultyScore: 5.0,
    reps: 4,
    lapses: 0,
    capturedDaysAgo: 27,
  },
  {
    slug: "median-of-two-sorted-arrays",
    id: 4,
    title: "Median of Two Sorted Arrays",
    difficulty: "Hard",
    tags: ["Array", "Binary Search", "Divide and Conquer"],
    statement:
      "Given two sorted arrays of sizes `m` and `n`, return the median of the combined data in `O(log(m + n))` time.",
    notes: "Binary search the partition on the shorter array.",
    state: "relearning",
    due: 0.3,
    stability: 1.4,
    difficultyScore: 8.9,
    reps: 5,
    lapses: 3,
    capturedDaysAgo: 44,
  },
  {
    slug: "two-sum",
    id: 1,
    title: "Two Sum",
    difficulty: "Easy",
    tags: ["Array", "Hash Table"],
    statement: "Return the indices of the two numbers in `nums` that add up to `target`.",
    notes: "Look up the complement **before** inserting the current value.",
    state: "review",
    due: 24,
    stability: 62,
    difficultyScore: 1.8,
    reps: 7,
    lapses: 0,
    capturedDaysAgo: 60,
  },
  {
    slug: "valid-parentheses",
    id: 20,
    title: "Valid Parentheses",
    difficulty: "Easy",
    tags: ["String", "Stack"],
    statement: "Given a string of brackets `()[]{}`, decide whether every opening bracket is closed in the correct order.",
    state: "review",
    due: 17,
    stability: 44,
    difficultyScore: 2.2,
    reps: 6,
    lapses: 0,
    capturedDaysAgo: 59,
  },
  {
    slug: "binary-search",
    id: 704,
    title: "Binary Search",
    difficulty: "Easy",
    tags: ["Array", "Binary Search"],
    statement: "Given a sorted array and a target, return its index or `-1`, in `O(log n)` time.",
    state: "review",
    due: 11,
    stability: 36,
    difficultyScore: 2.6,
    reps: 6,
    lapses: 0,
    capturedDaysAgo: 57,
  },
  {
    slug: "product-of-array-except-self",
    id: 238,
    title: "Product of Array Except Self",
    difficulty: "Medium",
    tags: ["Array", "Prefix Sum"],
    statement: "Return an array where each element is the product of all other elements, without using division.",
    state: "review",
    due: 6,
    stability: 19,
    difficultyScore: 4.4,
    reps: 5,
    lapses: 0,
    capturedDaysAgo: 46,
  },
  {
    slug: "search-in-rotated-sorted-array",
    id: 33,
    title: "Search in Rotated Sorted Array",
    difficulty: "Medium",
    tags: ["Array", "Binary Search"],
    statement: "A sorted array was rotated at an unknown pivot. Find `target` in `O(log n)` time.",
    notes: "One half is always sorted — check whether target lies inside it.",
    state: "review",
    due: 4,
    stability: 9.1,
    difficultyScore: 6.1,
    reps: 5,
    lapses: 1,
    capturedDaysAgo: 40,
  },
  {
    slug: "longest-increasing-subsequence",
    id: 300,
    title: "Longest Increasing Subsequence",
    difficulty: "Medium",
    tags: ["Array", "Binary Search", "Dynamic Programming"],
    statement: "Return the length of the longest strictly increasing subsequence of `nums`.",
    notes: "Patience sorting: `tails[i]` = smallest tail of an increasing subsequence of length i+1.",
    state: "review",
    due: 2,
    stability: 7.4,
    difficultyScore: 6.9,
    reps: 4,
    lapses: 1,
    capturedDaysAgo: 24,
  },
  {
    slug: "clone-graph",
    id: 133,
    title: "Clone Graph",
    difficulty: "Medium",
    tags: ["Hash Table", "Depth-First Search", "Breadth-First Search", "Graph"],
    statement: "Return a deep copy of a connected undirected graph given one of its nodes.",
    state: "review",
    due: 8,
    stability: 23,
    difficultyScore: 4.0,
    reps: 4,
    lapses: 0,
    capturedDaysAgo: 33,
  },
  {
    slug: "house-robber",
    id: 198,
    title: "House Robber",
    difficulty: "Medium",
    tags: ["Array", "Dynamic Programming"],
    statement: "Adjacent houses can't both be robbed. Return the maximum amount you can rob.",
    state: "review",
    due: 13,
    stability: 31,
    difficultyScore: 3.1,
    reps: 5,
    lapses: 0,
    capturedDaysAgo: 50,
  },
  {
    slug: "minimum-window-substring",
    id: 76,
    title: "Minimum Window Substring",
    difficulty: "Hard",
    tags: ["Hash Table", "String", "Sliding Window"],
    statement: "Return the shortest substring of `s` that contains every character of `t` (with multiplicity).",
    notes: "Track `missing` count; shrink only when `missing == 0`.",
    state: "review",
    due: 5,
    stability: 6.6,
    difficultyScore: 8.2,
    reps: 3,
    lapses: 1,
    capturedDaysAgo: 18,
  },
  {
    slug: "daily-temperatures",
    id: 739,
    title: "Daily Temperatures",
    difficulty: "Medium",
    tags: ["Array", "Stack", "Monotonic Stack"],
    statement: "For each day, return how many days you wait until a warmer temperature, or `0` if none.",
    state: "review",
    due: 9,
    stability: 17,
    difficultyScore: 3.8,
    reps: 3,
    lapses: 0,
    capturedDaysAgo: 15,
  },
  {
    slug: "edit-distance",
    id: 72,
    title: "Edit Distance",
    difficulty: "Medium",
    tags: ["String", "Dynamic Programming"],
    statement: "Return the minimum number of inserts, deletes, and replacements to turn `word1` into `word2`.",
    state: "learning",
    due: 1,
    stability: 2.4,
    difficultyScore: 6.6,
    reps: 2,
    lapses: 0,
    capturedDaysAgo: 5,
  },
  {
    slug: "serialize-and-deserialize-binary-tree",
    id: 297,
    title: "Serialize and Deserialize Binary Tree",
    difficulty: "Hard",
    tags: ["String", "Tree", "Depth-First Search", "Design", "Binary Tree"],
    statement: "Design an encoding that turns a binary tree into a string and back again without loss.",
    state: "learning",
    due: 0.7,
    stability: 0.8,
    difficultyScore: 7.4,
    reps: 1,
    capturedDaysAgo: 1,
  },
  {
    slug: "network-delay-time",
    id: 743,
    title: "Network Delay Time",
    difficulty: "Medium",
    tags: ["Depth-First Search", "Breadth-First Search", "Graph", "Heap (Priority Queue)", "Shortest Path"],
    statement: "Given weighted directed edges, return how long it takes a signal from node `k` to reach every node, or `-1`.",
    state: "learning",
    due: 0.4,
    stability: 0.6,
    difficultyScore: 6.2,
    reps: 1,
    capturedDaysAgo: 0.3,
  },
];

async function main() {
  const db = getDb();
  const [storedAi] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, QA_USER_ID), eq(schema.settings.key, "ai")))
    .limit(1);
  const aiSettings = qaAiSettings() ?? storedAi?.value;

  const problemRows: (typeof schema.problems.$inferInsert)[] = [];
  const submissionRows: (typeof schema.submissions.$inferInsert)[] = [];
  const cardRows: (typeof schema.cards.$inferInsert)[] = [];
  const eventRows: (typeof schema.reviewEvents.$inferInsert)[] = [];
  let requestCounter = 1;

  for (const p of problems) {
    const problemId = `demo-${p.slug}`;
    const captured = at(-p.capturedDaysAgo);
    const reps = p.reps ?? 0;

    // Spread past reviews between capture and "now", ending one scheduled
    // interval before the current due date.
    const reviewTimes: Date[] = [];
    if (reps > 0) {
      const lastReviewDaysAgo = Math.max(
        0.2,
        Math.min(p.capturedDaysAgo - 0.5, (p.stability ?? 1) - (p.due ?? 0)),
      );
      for (let i = 0; i < reps; i++) {
        const t = p.capturedDaysAgo - 0.2 - ((p.capturedDaysAgo - 0.2 - lastReviewDaysAgo) * (i / Math.max(1, reps - 1)) ** 1.4);
        reviewTimes.push(at(-t));
      }
    }
    const lastReview = reviewTimes.at(-1) ?? null;

    problemRows.push({
      id: problemId,
      userId: QA_USER_ID,
      leetcodeSlug: p.slug,
      leetcodeId: p.id,
      title: p.title,
      difficulty: p.difficulty,
      url: `https://leetcode.com/problems/${p.slug}/`,
      descriptionMd: p.statement,
      topicTags: p.tags,
      similarSlugs: [],
      notes: p.notes ?? null,
      fsrsDue: p.state === "new" ? null : at(p.due ?? 0),
      fsrsStability: p.stability ?? null,
      fsrsDifficulty: p.difficultyScore ?? null,
      fsrsElapsedDays: lastReview ? (now.getTime() - lastReview.getTime()) / DAY : null,
      fsrsScheduledDays: p.state === "new" ? null : Math.max(0, Math.round(p.stability ?? 0)),
      fsrsLearningSteps: 0,
      fsrsReps: reps,
      fsrsLapses: p.lapses ?? 0,
      fsrsState: p.state,
      fsrsLastReview: lastReview,
      createdAt: captured,
      updatedAt: lastReview ?? captured,
    });

    eventRows.push({
      id: `demo-event-${p.slug}-captured`,
      userId: QA_USER_ID,
      problemId,
      eventType: "problem_captured",
      occurredAt: captured,
    });

    let lapsesLeft = p.lapses ?? 0;
    reviewTimes.forEach((time, i) => {
      const progress = (i + 1) / reps;
      let rating = rand() < 0.2 ? 4 : rand() < 0.75 ? 3 : 2;
      if (lapsesLeft > 0 && i > 0 && rand() < lapsesLeft / (reps - i)) {
        rating = 1;
        lapsesLeft--;
      }
      eventRows.push({
        id: `demo-event-${p.slug}-rated-${i}`,
        userId: QA_USER_ID,
        problemId,
        eventType: "self_recall_rated",
        fsrsRating: rating,
        requestId: `00000000-0000-4000-8000-${String(requestCounter++).padStart(12, "0")}`,
        fsrsStabilitySnap: Math.max(0.5, (p.stability ?? 1) * progress),
        fsrsDifficultySnap: p.difficultyScore ?? 5,
        fsrsRetrievabilitySnap: 0.72 + rand() * 0.25,
        occurredAt: time,
      });
    });

    (p.cards ?? []).forEach(([question, answer], i) => {
      const created = at(-(p.capturedDaysAgo - 1 - i));
      cardRows.push({
        id: `demo-card-${p.slug}-${i}`,
        userId: QA_USER_ID,
        problemId,
        question,
        answer,
        aiStatus: "ready",
        createdAt: created,
        updatedAt: created,
      });
    });
  }

  // A few extra reviews already done today so the Today page looks mid-session.
  for (const slug of ["two-sum", "valid-parentheses"]) {
    eventRows.push({
      id: `demo-event-${slug}-today`,
      userId: QA_USER_ID,
      problemId: `demo-${slug}`,
      eventType: "self_recall_rated",
      fsrsRating: 3,
      requestId: `00000000-0000-4000-8000-${String(requestCounter++).padStart(12, "0")}`,
      fsrsStabilitySnap: 40,
      fsrsDifficultySnap: 2,
      fsrsRetrievabilitySnap: 0.93,
      occurredAt: at(-0.08),
    });
  }

  submissionRows.push(
    submission("coin-change", "greedy-wa", 40, "Wrong Answer", "python3", [
      "class Solution:",
      "    def coinChange(self, coins: List[int], amount: int) -> int:",
      "        coins.sort(reverse=True)",
      "        count = 0",
      "        for c in coins:",
      "            take = amount // c",
      "            count += take",
      "            amount -= take * c",
      "        return count if amount == 0 else -1",
    ], { failedTestcase: "[1,3,4]\n6", expectedOutput: "2", actualOutput: "3" }),
    submission("coin-change", "recursion-tle", 39.9, "Time Limit Exceeded", "python3", [
      "class Solution:",
      "    def coinChange(self, coins: List[int], amount: int) -> int:",
      "        def best(rest):",
      "            if rest == 0:",
      "                return 0",
      "            if rest < 0:",
      "                return float('inf')",
      "            return min(best(rest - c) + 1 for c in coins)",
      "        ans = best(amount)",
      "        return -1 if ans == float('inf') else ans",
    ], { failedTestcase: "[1,2,5]\n100" }),
    submission("coin-change", "dp-ac", 39.8, "Accepted", "python3", [
      "class Solution:",
      "    def coinChange(self, coins: List[int], amount: int) -> int:",
      "        dp = [0] + [amount + 1] * amount",
      "        for x in range(1, amount + 1):",
      "            for c in coins:",
      "                if c <= x:",
      "                    dp[x] = min(dp[x], dp[x - c] + 1)",
      "        return dp[amount] if dp[amount] <= amount else -1",
    ], { runtimeMs: 612, memoryKb: 17_800 }),
    submission("task-scheduler", "ac", 37.5, "Accepted", "java", [
      "class Solution {",
      "    public int leastInterval(char[] tasks, int n) {",
      "        int[] freq = new int[26];",
      "        for (char t : tasks) freq[t - 'A']++;",
      "        int max = Arrays.stream(freq).max().getAsInt();",
      "        int ties = (int) Arrays.stream(freq).filter(f -> f == max).count();",
      "        return Math.max(tasks.length, (max - 1) * (n + 1) + ties);",
      "    }",
      "}",
    ], { runtimeMs: 3, memoryKb: 45_200 }),
    submission("longest-substring-without-repeating-characters", "wa", 51.8, "Wrong Answer", "typescript", [
      "function lengthOfLongestSubstring(s: string): number {",
      "  const last = new Map<string, number>();",
      "  let left = 0, best = 0;",
      "  for (let i = 0; i < s.length; i++) {",
      "    if (last.has(s[i])) left = last.get(s[i])! + 1;",
      "    last.set(s[i], i);",
      "    best = Math.max(best, i - left + 1);",
      "  }",
      "  return best;",
      "}",
    ], { failedTestcase: '"abba"', expectedOutput: "2", actualOutput: "3" }),
    submission("longest-substring-without-repeating-characters", "ac", 51.7, "Accepted", "typescript", [
      "function lengthOfLongestSubstring(s: string): number {",
      "  const last = new Map<string, number>();",
      "  let left = 0, best = 0;",
      "  for (let i = 0; i < s.length; i++) {",
      "    if (last.has(s[i])) left = Math.max(left, last.get(s[i])! + 1);",
      "    last.set(s[i], i);",
      "    best = Math.max(best, i - left + 1);",
      "  }",
      "  return best;",
      "}",
    ], { runtimeMs: 7, memoryKb: 52_100 }),
    submission("course-schedule", "ac", 29.6, "Accepted", "cpp", [
      "bool canFinish(int n, vector<vector<int>>& pre) {",
      "    vector<vector<int>> g(n); vector<int> indeg(n);",
      "    for (auto& e : pre) { g[e[1]].push_back(e[0]); indeg[e[0]]++; }",
      "    queue<int> q; for (int i = 0; i < n; i++) if (!indeg[i]) q.push(i);",
      "    int done = 0;",
      "    while (!q.empty()) { int u = q.front(); q.pop(); done++;",
      "        for (int v : g[u]) if (--indeg[v] == 0) q.push(v); }",
      "    return done == n;",
      "}",
    ], { runtimeMs: 11, memoryKb: 17_300 }),
    submission("trapping-rain-water", "ac", 54, "Accepted", "python3", [
      "class Solution:",
      "    def trap(self, height: List[int]) -> int:",
      "        l, r = 0, len(height) - 1",
      "        lmax = rmax = water = 0",
      "        while l < r:",
      "            if height[l] < height[r]:",
      "                lmax = max(lmax, height[l]); water += lmax - height[l]; l += 1",
      "            else:",
      "                rmax = max(rmax, height[r]); water += rmax - height[r]; r -= 1",
      "        return water",
    ], { runtimeMs: 95, memoryKb: 18_900 }),
  );

  await db.transaction(async (tx) => {
    await tx.delete(schema.user).where(eq(schema.user.id, QA_USER_ID));
    // Credit records outlive account deletion (no FK to user), and the fixture
    // account is recreated with the same id, so clear them for a clean reset.
    await tx.delete(schema.creditPurchases).where(eq(schema.creditPurchases.userId, QA_USER_ID));
    await tx.delete(schema.aiCreditLedger).where(eq(schema.aiCreditLedger.userId, QA_USER_ID));

    await tx.insert(schema.user).values({
      id: QA_USER_ID,
      name: "Alex Chen",
      email: QA_USER_EMAIL,
      emailVerified: true,
      createdAt: at(-62),
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

    await tx.insert(schema.problems).values(problemRows);
    await tx.insert(schema.submissions).values(submissionRows);
    await tx.insert(schema.cards).values(cardRows);
    for (let i = 0; i < eventRows.length; i += 100) {
      await tx.insert(schema.reviewEvents).values(eventRows.slice(i, i + 100));
    }

    const completedAt = at(-60).toISOString();
    await tx.insert(schema.settings).values([
      {
        userId: QA_USER_ID,
        key: "review",
        value: { dailyReviewLimit: 20, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      },
      { userId: QA_USER_ID, key: "generation", value: { language: "en" } },
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
      ...(aiSettings ? [{ userId: QA_USER_ID, key: "ai", value: aiSettings }] : []),
    ]);
  });

  console.log(
    `✓ Demo deck loaded: ${problemRows.length} problems, ${submissionRows.length} submissions, ${cardRows.length} cards, ${eventRows.length} events`,
  );
  console.log("  Login: http://localhost:3000/api/qa/login");
}

function submission(
  slug: string,
  key: string,
  daysAgo: number,
  status: (typeof schema.submissions.$inferInsert)["status"],
  language: string,
  code: string[],
  extra: Partial<typeof schema.submissions.$inferInsert> = {},
): typeof schema.submissions.$inferInsert {
  return {
    id: `demo-submission-${slug}-${key}`,
    userId: QA_USER_ID,
    problemId: `demo-${slug}`,
    leetcodeSubmissionId: `demo-${slug}-${key}`,
    language,
    code: code.join("\n"),
    status,
    submittedAt: at(-daysAgo),
    ...extra,
  };
}

function qaAiSettings() {
  const provider = process.env.ANKIFY_QA_AI_PROVIDER?.trim();
  const model = process.env.ANKIFY_QA_AI_MODEL?.trim();
  const apiKey = process.env.ANKIFY_QA_AI_API_KEY?.trim();
  const reasoningMode = process.env.ANKIFY_QA_AI_REASONING_MODE?.trim() || "fast";
  if (!provider || !model || !apiKey) return null;
  if (provider !== "openai" && provider !== "anthropic" && provider !== "deepseek") return null;
  return { provider, model, reasoningMode, encryptedApiKey: encryptSecret(apiKey) };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
