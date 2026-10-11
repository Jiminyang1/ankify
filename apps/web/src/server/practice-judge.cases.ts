import type { TalkApproachStatus, TalkReference, TalkReply } from "@ankify/core";
import type { TalkLogEntry } from "@ankify/db";
import type { JudgeInput } from "./practice-judge";

/**
 * Hand-labeled replies for the practice judge (docs/coach-practice.md,
 * version 3). scripts/judge-eval.ts runs the real judge on them and reports
 * agreement; practice-judge.test.ts checks they're well-formed. Labels are
 * what a careful human grader would tick. `maybe` lists points a reasonable
 * grader could go either way on: crediting them or not both count as agreement.
 */

export type JudgeCase = {
  id: string;
  input: JudgeInput;
  expected: {
    reply: TalkReply;
    approachId?: string | null;
    /** One or several acceptable statuses; omitted = not scored. */
    approachStatus?: TalkApproachStatus | TalkApproachStatus[];
    /** Points that must be credited; null = not scored. */
    covered: string[] | null;
    maybe?: string[];
    misconception?: boolean;
  };
};

const ASK = "How would you solve this one, and what does it cost in time and space?";
const tutor = (text: string): TalkLogEntry => ({ role: "tutor", text });
const learner = (text: string, help: 0 | 1 | 2 = 0): TalkLogEntry => ({ role: "learner", text, help });
const approachQuestion = "How the learner would solve this problem, and what it costs in time and space.";
const weaknessQuestion =
  "Whether the learner now gets this right on this problem (the reference is a mistake they made before).";

/* ── 678. Valid Parenthesis String ── */

const VPS = {
  title: "Valid Parenthesis String",
  difficulty: "Medium",
  statement:
    "Given a string s containing only three types of characters: '(', ')' and '*', return true if s is valid. Every '(' must have a matching ')' after it and every ')' a matching '(' before it. '*' can be treated as a single ')', a single '(' or an empty string. 1 <= s.length <= 100.",
};
const VPS_REF: TalkReference = {
  mode: "key_points",
  approaches: [
    {
      id: "a1",
      name: "lo/hi range",
      mine: true,
      points: [
        { id: "p1", text: "lo and hi track the fewest and the most unmatched '(' possible so far" },
        { id: "p2", text: "'(' raises both, ')' lowers both, '*' lowers lo and raises hi, covering all three meanings at once" },
        { id: "p3", text: "if hi drops below 0 there are too many ')', so fail early; lo never goes below 0" },
        { id: "p4", text: "the string is valid exactly when lo is 0 at the end" },
        { id: "p5", text: "Complexity: O(n) time, O(1) space" },
      ],
    },
    {
      id: "a2",
      name: "Interval DP",
      mine: false,
      points: [
        { id: "p1", text: "dp[i][j] says whether s[i..j] can be valid" },
        {
          id: "p2",
          text: "s[i..j] is valid if s[i] is '*' as empty and s[i+1..j] is valid, or s[i] acts as '(' matched with some s[k] acting as ')' with both the inside and the rest valid",
        },
        { id: "p3", text: "Complexity: O(n^3) time, O(n^2) space" },
      ],
    },
    {
      id: "a3",
      name: "Two stacks",
      mine: false,
      points: [
        { id: "p1", text: "one stack of indices of '(' and one of indices of '*'" },
        { id: "p2", text: "a ')' pops a '(' first, else a '*', else fails" },
        { id: "p3", text: "at the end every remaining '(' needs a '*' at a later index" },
        { id: "p4", text: "Complexity: O(n) time, O(n) space" },
      ],
    },
  ],
};
const vps = (log: TalkLogEntry[]): JudgeInput => ({ problem: VPS, question: approachQuestion, reference: VPS_REF, log });

/* ── 322. Coin Change ── */

const COINS = {
  title: "Coin Change",
  difficulty: "Medium",
  statement:
    "You are given an integer array coins of different denominations and an integer amount. Return the fewest number of coins that you need to make up that amount, or -1 if it can't be made up. You have an infinite number of each coin. 1 <= coins.length <= 12, 1 <= coins[i] <= 2^31 - 1, 0 <= amount <= 10^4.",
};
const COINS_REF: TalkReference = {
  mode: "key_points",
  approaches: [
    {
      id: "a1",
      name: "Bottom-up DP",
      mine: true,
      points: [
        { id: "p1", text: "dp[x] is the fewest coins that make amount x" },
        { id: "p2", text: "dp[0] = 0 and every other entry starts at infinity (amount + 1), meaning unreachable" },
        { id: "p3", text: "dp[x] = min over coins c <= x of dp[x - c] + 1" },
        { id: "p4", text: "return -1 when dp[amount] is still unreachable" },
        { id: "p5", text: "Complexity: O(amount * n) time, O(amount) space" },
      ],
    },
    {
      id: "a2",
      name: "BFS over amounts",
      mine: false,
      points: [
        { id: "p1", text: "each amount is a node, and subtracting a coin is an edge" },
        { id: "p2", text: "BFS from amount reaches 0 in the fewest steps, which is the fewest coins" },
        { id: "p3", text: "a visited set keeps each amount from being expanded twice" },
        { id: "p4", text: "Complexity: O(amount * n) time, O(amount) space" },
      ],
    },
  ],
};
const COINS_WEAK: TalkReference = {
  mode: "avoid_mistake",
  approaches: [
    {
      id: "w",
      name: "init_sentinel",
      mine: false,
      points: [{ id: "p1", text: "dp was initialized to 0 for every amount, so unreachable amounts looked free" }],
    },
  ],
};
const coins = (log: TalkLogEntry[]): JudgeInput => ({ problem: COINS, question: approachQuestion, reference: COINS_REF, log });
const coinsWeak = (log: TalkLogEntry[]): JudgeInput => ({
  problem: COINS,
  question: weaknessQuestion,
  reference: COINS_WEAK,
  log,
});
const WEAK_ASK = "How do you set up the dp array before filling it, and why?";

/* ── 1. Two Sum ── */

const TWO_SUM = {
  title: "Two Sum",
  difficulty: "Easy",
  statement:
    "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. Each input has exactly one solution, and you may not use the same element twice. 2 <= nums.length <= 10^4.",
};
const TWO_SUM_REF: TalkReference = {
  mode: "key_points",
  approaches: [
    {
      id: "a1",
      name: "One-pass hash map",
      mine: true,
      points: [
        { id: "p1", text: "a hash map from each value seen so far to its index" },
        { id: "p2", text: "for each number, look up target - num in the map" },
        { id: "p3", text: "look up before inserting the current number, so it can't pair with itself" },
        { id: "p4", text: "Complexity: O(n) time, O(n) space" },
      ],
    },
    {
      id: "a2",
      name: "Sort with two pointers",
      mine: false,
      points: [
        { id: "p1", text: "sort (value, index) pairs so the original indices survive" },
        { id: "p2", text: "move the left pointer up when the sum is too small and the right pointer down when it's too big" },
        { id: "p3", text: "Complexity: O(n log n) time, O(n) space" },
      ],
    },
  ],
};
const twoSum = (log: TalkLogEntry[]): JudgeInput => ({
  problem: TWO_SUM,
  question: approachQuestion,
  reference: TWO_SUM_REF,
  log,
});

export const JUDGE_CASES: JudgeCase[] = [
  {
    id: "vps-complete",
    input: vps([
      tutor(ASK),
      learner(
        "I'd keep a range [lo, hi] for how many open parens could be unmatched. '(' increments both, ')' decrements both, '*' decrements lo and increments hi since it could be any of the three. If hi ever goes negative return false, and clamp lo at 0. At the end it's valid iff lo == 0. One pass, O(n) time and O(1) space.",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3", "p4", "p5"], misconception: false },
  },
  {
    id: "vps-paraphrased",
    input: vps([
      tutor(ASK),
      learner(
        "Track the min and max possible open count while scanning. A star can be open, close or nothing, so the min goes down one and the max goes up one; normal brackets move both the same way. If the max is ever negative it's impossible. Keep the min from going negative. The answer is whether the min ends at zero. Linear time, constant memory.",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3", "p4", "p5"], misconception: false },
  },
  {
    id: "vps-code-only",
    input: vps([
      tutor(ASK),
      learner(
        "lo = hi = 0\nfor c in s:\n    if c == '(':\n        lo += 1; hi += 1\n    elif c == ')':\n        lo -= 1; hi -= 1\n    else:\n        lo -= 1; hi += 1\n    if hi < 0:\n        return False\n    lo = max(lo, 0)\nreturn lo == 0",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p2", "p3", "p4"], maybe: ["p1"], misconception: false },
  },
  {
    id: "vps-half",
    input: vps([
      tutor(ASK),
      learner("I keep two counters, lo and hi, for the min and max number of unmatched open parens, and scan the string once."),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: ["known", "unclear"], covered: ["p1"], misconception: false },
  },
  {
    id: "vps-wrong-idea",
    input: vps([
      tutor(ASK),
      learner("Treat every '*' as '(' and then check that the count never goes negative and ends at zero."),
    ]),
    expected: { reply: "answer", approachStatus: "invalid", covered: null, misconception: true },
  },
  {
    id: "vps-brute-force",
    input: vps([
      tutor(ASK),
      learner(
        "Try every assignment of each '*' to '(', ')' or empty with backtracking, and check each resulting string with a counter. That's 3^k strings for k stars.",
      ),
    ]),
    expected: { reply: "answer", approachId: null, approachStatus: "suboptimal", covered: null },
  },
  {
    id: "vps-vague",
    input: vps([tutor(ASK), learner("I think it's some greedy thing with counting.")]),
    expected: { reply: "answer", approachStatus: "unclear", covered: [], maybe: ["p1"], misconception: false },
  },
  {
    id: "vps-narrowed-vague",
    input: vps([
      tutor(ASK),
      learner("Keep lo and hi, the min and max open count.", 0),
      tutor("Good start. How does a '*' change lo and hi?"),
      learner("It changes both of them.", 1),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: ["known", "unclear"], covered: ["p1"], misconception: false },
  },
  {
    id: "vps-side-question",
    input: vps([tutor(ASK), learner("Wait, can the input string be empty?")]),
    expected: { reply: "side_question", covered: [] },
  },
  {
    id: "vps-give-up",
    input: vps([tutor(ASK), learner("I really can't get it, just show me how it's done.")]),
    expected: { reply: "give_up", covered: [] },
  },
  {
    id: "vps-zh",
    input: vps([
      tutor(ASK),
      learner(
        "用两个变量 lo 和 hi 表示未匹配左括号数量的最小值和最大值。遇到左括号都加一，右括号都减一，星号让 lo 减一、hi 加一。hi 小于 0 就直接返回 false，lo 不能小于 0。最后看 lo 是不是 0。时间 O(n)，空间 O(1)。",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3", "p4", "p5"], misconception: false },
  },
  {
    id: "vps-accumulated",
    input: vps([
      tutor(ASK),
      learner("lo/hi for the min and max open count. '(' raises both and ')' lowers both, '*' lowers lo and raises hi.", 0),
      tutor("Anything else?"),
      learner("If hi < 0 return false, lo stays at least 0, and at the end lo has to be 0. O(n) time, O(1) space.", 0),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3", "p4", "p5"], misconception: false },
  },
  {
    id: "vps-dp",
    input: vps([
      tutor(ASK),
      learner(
        "dp[i][j] = whether substring i..j can be valid. Either s[i] is '*' used as empty and dp[i+1][j] holds, or s[i] acts as '(' paired with some k where s[k] can be ')', with dp[i+1][k-1] and dp[k+1][j] both true. O(n^3) time, O(n^2) space.",
      ),
    ]),
    expected: { reply: "answer", approachId: "a2", approachStatus: "known", covered: ["p1", "p2", "p3"], misconception: false },
  },

  {
    id: "coins-complete",
    input: coins([
      tutor(ASK),
      learner(
        "dp[x] = min coins for amount x. dp[0] = 0 and the rest start at infinity. For each x from 1 to amount and each coin c <= x, dp[x] = min(dp[x], dp[x - c] + 1). If dp[amount] is still infinity return -1. Time O(amount * number of coins), space O(amount).",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3", "p4", "p5"], misconception: false },
  },
  {
    id: "coins-greedy",
    input: coins([tutor(ASK), learner("Sort the coins from largest to smallest and always take the largest coin that still fits.")]),
    expected: { reply: "answer", approachStatus: "invalid", covered: null, misconception: true },
  },
  {
    id: "coins-half",
    input: coins([
      tutor(ASK),
      learner("It's DP where dp[x] is the minimum number of coins for x, and you build it up from smaller amounts."),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: ["known", "unclear"], covered: ["p1"], misconception: false },
  },
  {
    id: "coins-wrong-cost",
    input: coins([
      tutor(ASK),
      learner(
        "dp[x] is the fewest coins for x, dp[0] = 0, everything else infinity. dp[x] = min(dp[x - c] + 1) over the coins. Return -1 if dp[amount] stays infinite. It's O(amount^2) time and O(amount) space.",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3", "p4"], misconception: true },
  },
  {
    id: "coins-bfs",
    input: coins([
      tutor(ASK),
      learner(
        "Think of amounts as nodes; subtracting a coin moves you to another node. BFS from amount, and the level where you first hit 0 is the answer. Keep a visited set so you don't revisit amounts. O(amount * n) time, O(amount) space.",
      ),
    ]),
    expected: { reply: "answer", approachId: "a2", approachStatus: "known", covered: ["p1", "p2", "p3", "p4"], misconception: false },
  },
  {
    id: "coins-blank",
    input: coins([tutor(ASK), learner("idk")]),
    expected: { reply: "blank", covered: [] },
  },
  {
    id: "coins-hint-request",
    input: coins([tutor(ASK), learner("Can you give me a hint to get started?")]),
    expected: { reply: "hint_request", covered: [] },
  },
  {
    id: "coins-code-only",
    input: coins([
      tutor(ASK),
      learner(
        "dp = [amount + 1] * (amount + 1)\ndp[0] = 0\nfor x in range(1, amount + 1):\n    for c in coins:\n        if c <= x:\n            dp[x] = min(dp[x], dp[x - c] + 1)\nreturn dp[amount] if dp[amount] <= amount else -1",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p2", "p3", "p4"], maybe: ["p1"], misconception: false },
  },
  {
    id: "coins-zh",
    input: coins([
      tutor(ASK),
      learner("dp[i] 表示凑出金额 i 最少要几枚硬币，dp[0]=0，其他初始化成无穷大。转移是 dp[i] = min(dp[i - c] + 1)。最后如果还是无穷大就返回 -1。"),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3", "p4"], misconception: false },
  },
  {
    id: "coins-side-question",
    input: coins([tutor(ASK), learner("Is the amount allowed to be zero?")]),
    expected: { reply: "side_question", covered: [] },
  },
  {
    id: "coins-weak-fixed",
    input: coinsWeak([
      tutor(WEAK_ASK),
      learner("dp[0] is 0 and everything else starts at a big number like amount + 1, so unreachable amounts don't look like zero coins."),
    ]),
    expected: { reply: "answer", covered: ["p1"], misconception: false },
  },
  {
    id: "coins-weak-repeated",
    input: coinsWeak([tutor(WEAK_ASK), learner("Initialize the whole dp array to 0, then take the min for each amount.")]),
    expected: { reply: "answer", covered: [], misconception: true },
  },

  {
    id: "two-sum-complete",
    input: twoSum([
      tutor(ASK),
      learner(
        "One pass with a hash map from value to index. For each number, check whether target - num is already in the map; if so return both indices, otherwise insert the number. Checking before inserting means a number can't pair with itself. O(n) time and O(n) space.",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3", "p4"], misconception: false },
  },
  {
    id: "two-sum-paraphrased",
    input: twoSum([
      tutor(ASK),
      learner(
        "Walk the array keeping a dictionary of the numbers I've already passed and where they were. For each value, if its complement is already in the dictionary I'm done; otherwise I add it. Since I look before adding, an element can't be matched with itself. Linear time and linear extra space.",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3", "p4"], misconception: false },
  },
  {
    id: "two-sum-half",
    input: twoSum([tutor(ASK), learner("Use a hash map of value to index and look for target minus the current number.")]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2"], misconception: false },
  },
  {
    id: "two-sum-narrowed",
    input: twoSum([
      tutor(ASK),
      learner("Hash map of value to index, look up target minus num.", 0),
      tutor("When do you insert the current number, and why does that order matter?"),
      learner("After checking. Otherwise with target 6 and a 3 you'd return the same index twice.", 1),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3"], misconception: false },
  },
  {
    id: "two-sum-sort-bug",
    input: twoSum([tutor(ASK), learner("Sort the array, use two pointers from both ends, and return the two pointers' indices.")]),
    expected: { reply: "answer", approachStatus: ["invalid", "known"], covered: null, misconception: true },
  },
  {
    id: "two-sum-side-question",
    input: twoSum([tutor(ASK), learner("What if there are two valid answers?")]),
    expected: { reply: "side_question", covered: [] },
  },
  {
    id: "two-sum-skip",
    input: twoSum([tutor(ASK), learner("skip")]),
    expected: { reply: "give_up", covered: [] },
  },
  {
    id: "two-sum-zh",
    input: twoSum([
      tutor(ASK),
      learner("一边遍历一边用哈希表存值到下标，先查 target - x 在不在表里，再把 x 放进去，这样不会和自己配对。时间 O(n)，空间 O(n)。"),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3", "p4"], misconception: false },
  },
  {
    id: "two-sum-code-only",
    input: twoSum([
      tutor(ASK),
      learner(
        "const seen = new Map();\nfor (let i = 0; i < nums.length; i++) {\n  const need = target - nums[i];\n  if (seen.has(need)) return [seen.get(need), i];\n  seen.set(nums[i], i);\n}",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2"], maybe: ["p3"], misconception: false },
  },
  {
    id: "two-sum-vague",
    input: twoSum([tutor(ASK), learner("hashing")]),
    expected: { reply: "answer", approachStatus: ["unclear", "known"], covered: [], maybe: ["p1"], misconception: false },
  },
  {
    id: "two-sum-zh-no-cost",
    input: twoSum([
      tutor("你打算怎么解这道题？时间与空间的代价分别是什么？"),
      learner("用一个哈希表存值到下标，遍历的时候找 target - nums[i] 在不在表里。", 0),
      tutor("还有要补充的吗？为什么这样做是对的？"),
      learner("命中了就返回两个下标，没命中就把当前值放进去。", 0),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2"], maybe: ["p3"], misconception: false },
  },
  {
    id: "two-sum-two-pointers",
    input: twoSum([
      tutor(ASK),
      learner(
        "Pair each value with its index and sort by value, then two pointers from both ends: if the sum is too small move the left one right, if it's too big move the right one left. O(n log n) time for the sort, O(n) space for the pairs.",
      ),
    ]),
    expected: { reply: "answer", approachId: "a2", approachStatus: "known", covered: ["p1", "p2", "p3"], misconception: false },
  },
  {
    id: "two-sum-wrong-cost",
    input: twoSum([
      tutor(ASK),
      learner(
        "Keep a hash map of value to index; for each number check if target minus it is in the map before adding it, so it can't pair with itself. That's O(1) time overall because hash lookups are O(1).",
      ),
    ]),
    expected: { reply: "answer", approachId: "a1", approachStatus: "known", covered: ["p1", "p2", "p3"], misconception: true },
  },
];
