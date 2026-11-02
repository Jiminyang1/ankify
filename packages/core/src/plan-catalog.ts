import {
  PLAN_COURSE_URL,
  PLAN_FREQUENT_ROWS,
  PLAN_LIST_ROWS,
  PLAN_PROBLEM_ROWS,
  PLAN_STEP_ROWS,
  PLAN_VIDEO_ROWS,
} from "./plan-catalog.generated";
import { findOfficialStudyPlan } from "./study-plans";
import type { LeetCodeDifficulty } from "./types";

/**
 * The study-plan map as data: 灵茶山艾府's course, core route, and twelve lists
 * (his classification, used with his permission), the high-frequency lists,
 * and LeetCode's official plans, with every problem they use. Snapshotted by
 * `pnpm plans:catalog`; English names are our own.
 *
 * The data is large (~400 KB), so this module has its own entry point
 * (`@ankify/core/plan-catalog`) and only server code imports it. Clients get
 * the tree from `GET /api/study-plan/catalog` and may import types only.
 */

/* ── Generated rows ── */

/** A frontend id, or the slug of a leetcode.cn-only problem. */
type PlanProblemRef = number | string;

export type PlanProblemRow = readonly [
  slug: string,
  id: number,
  zh: string,
  en: string,
  rating: number,
  difficulty: number,
  premium: number,
  cnOnly: number,
  tagBits: number,
  label?: string,
];

export interface PlanSectionRow {
  id: string;
  zh: string;
  en: string;
  o?: number;
  cap?: number;
  ref?: string;
  p?: readonly PlanProblemRef[];
  c?: readonly PlanSectionRow[];
  topic?: string;
  url?: string;
}

export interface PlanVideoRow {
  zh: string;
  en: string;
  url: string;
  p: readonly PlanProblemRef[];
  hw: readonly PlanProblemRef[];
  links: readonly string[];
}

export interface PlanStepRow {
  zh: string;
  en: string;
  topic: string;
  cap: number;
  secs: readonly string[];
}

export interface PlanFrequentRow {
  id: string;
  zh: string;
  url: string;
  g: readonly { zh: string; en: string; p: readonly PlanProblemRef[] }[];
}

/* ── Public types ── */

export type PlanCatalogTag = "nc150" | "nc250" | "hot100" | "top150";

export interface PlanCatalogProblem {
  slug: string;
  /** The frontend id; 0 for leetcode.cn-only problems. */
  id: number;
  /** What to show as its number: "LCP 68", or the id as text. */
  label: string;
  zh: string;
  /** Empty for leetcode.cn-only problems. */
  en: string;
  rating: number | null;
  /** null for leetcode.cn-only problems. */
  difficulty: LeetCodeDifficulty | null;
  premium: boolean;
  cnOnly: boolean;
  tags: readonly PlanCatalogTag[];
}

export type PlanCatalogNodeKind = "root" | "group" | "block" | "dictionary" | "video" | "list" | "step" | "section";

export interface PlanCatalogNode {
  id: string;
  kind: PlanCatalogNodeKind;
  title: { en: string; zh: string };
  optional?: boolean;
  url?: string;
  /** Video nodes: the lesson. */
  videoUrl?: string;
  /** This node's own problems. On a video, the ones worked in the lesson. */
  problems: readonly string[];
  /** Video nodes: the homework. */
  homework?: readonly string[];
  children: readonly PlanCatalogNode[];
  /** The plan "set as current" switches to. */
  plan?: string;
  /** NeetCode 250: the plan to switch to while a tag is selected. */
  tagPlans?: Partial<Record<PlanCatalogTag, string>>;
  /**
   * Step nodes and their sections: the rating cap they were cut under.
   * Dictionary sections: the cap of the route step that uses them, so problems
   * passing `withinStepCap()` there are on the route.
   */
  stepCap?: number;
  /** Route steps: the list that goes deeper. */
  deepDive?: string;
  /** Video nodes: the dictionary sections it teaches. */
  links?: readonly string[];
  /** Dictionary and route sections: the video nodes teaching this section. */
  videos?: readonly string[];
  /** Dictionary sections that only point elsewhere ("see that list"). */
  ref?: string;
  /** Route sections: the dictionary section this was cut from. */
  source?: string;
  /** Route sections brought in through a `ref`: the list they came from. */
  via?: string;
}

export interface PlanCatalog {
  tree: PlanCatalogNode;
  problems: Readonly<Record<string, PlanCatalogProblem>>;
}

/** The sets the page's meters count. `main` is what a user works through; the
 *  dictionary is for looking things up and isn't part of it. */
export interface PlanListSets {
  course: readonly string[];
  route: readonly string[];
  nc150: readonly string[];
  nc250: readonly string[];
  hot100: readonly string[];
  top150: readonly string[];
  main: readonly string[];
  dictionary: readonly string[];
}

/* ── Constants ── */

export const PLAN_COURSE_SLUG = "ling:course";
export const PLAN_ROUTE_SLUG = "ling:route";
export const PLAN_ROUTE_SOURCE_URL = "https://leetcode.cn/discuss/post/3141566/ru-he-ke-xue-shua-ti-by-endlesscheng-q3yd/";
export const PLAN_COURSE_SOURCE_URL = PLAN_COURSE_URL;
export const NEETCODE_SOURCE_URL = "https://neetcode.io/practice";
const PRIMER_URL = "https://leetcode.cn/studyplan/primers-list/";

const TAG_BITS: readonly (readonly [number, PlanCatalogTag])[] = [
  [1, "nc150"],
  [2, "nc250"],
  [4, "hot100"],
  [8, "top150"],
];
const DIFFICULTIES: readonly LeetCodeDifficulty[] = ["Easy", "Medium", "Hard"];

/** Plans for the frequent-list blocks, and the official plans added to the map. */
const FREQUENT_BLOCKS: Readonly<Record<string, { en: string; zh: string; plan: string }>> = {
  N: { en: "NeetCode 150 / 250", zh: "NeetCode 150 / 250", plan: "neetcode-250" },
  H: { en: "Top 100 Liked", zh: "LeetCode 热题 100", plan: "top-100-liked" },
  T: { en: "Top Interview 150", zh: "面试经典 150 题", plan: "top-interview-150" },
};
const OFFICIAL_TITLES: Readonly<Record<string, string>> = {
  "leetcode-75": "LeetCode 75",
  "dynamic-programming": "动态规划",
  "graph-theory": "图论",
  "binary-search": "二分查找",
};
/** Chinese names for the official plans' English group names. */
const OFFICIAL_GROUP_ZH: Readonly<Record<string, string>> = {
  "Array / String": "数组 / 字符串",
  "Two Pointers": "双指针",
  "Sliding Window": "滑动窗口",
  "Prefix Sum": "前缀和",
  "Hash Map / Set": "哈希表 / 集合",
  Stack: "栈",
  Queue: "队列",
  "Linked List": "链表",
  "Binary Tree - DFS": "二叉树 - DFS",
  "Binary Tree - BFS": "二叉树 - BFS",
  "Binary Search Tree": "二叉搜索树",
  "Graphs - DFS": "图 - DFS",
  "Graphs - BFS": "图 - BFS",
  "Heap / Priority Queue": "堆 / 优先队列",
  "Binary Search": "二分查找",
  Backtracking: "回溯",
  "DP - 1D": "动态规划 - 一维",
  "DP - Multidimensional": "动态规划 - 多维",
  "Bit Manipulation": "位运算",
  Trie: "字典树",
  Intervals: "区间",
  "Monotonic Stack": "单调栈",
  "Fibonacci style": "斐波那契型",
  Matrix: "矩阵",
  "On Strings": "字符串上",
  "Longest Increasing Subsequence": "最长递增子序列",
  "Longest Common Subsequence": "最长公共子序列",
  "Best Time to Buy & Sell Stock / State Machine": "买卖股票 / 状态机",
  "On Trees": "树上",
  Knapsack: "背包",
  "General 1D": "一般一维",
  "Standard Traversal": "标准遍历",
  BFS: "BFS",
  "Matrix Graphs": "网格图",
  "Graph Theory": "图论",
  "Union Find / DSU": "并查集",
  "Topological Sort": "拓扑排序",
  "Search In Array": "数组查找",
  "Rotated Array": "旋转数组",
  "Standard Search": "标准查找",
  Math: "数学",
  "Tricky Invariant": "巧妙的不变量",
  "As A Tool": "作为工具",
};

/** On the core route under this cap: free, and at or under it by rating, or
 *  not Hard when it never had a contest rating. */
export function withinStepCap(problem: PlanCatalogProblem, cap: number): boolean {
  if (problem.premium) return false;
  return problem.rating != null ? problem.rating <= cap : problem.difficulty !== "Hard";
}

/* ── Building the map ── */

type Built = PlanCatalog & {
  nodes: ReadonlyMap<string, PlanCatalogNode>;
  sets: Readonly<PlanListSets>;
};

function build(): Built {
  const problems: Record<string, PlanCatalogProblem> = Object.create(null);
  const slugByRef = new Map<PlanProblemRef, string>();
  for (const [slug, id, zh, en, rating, difficulty, premium, cnOnly, tagBits, label] of PLAN_PROBLEM_ROWS) {
    problems[slug] = {
      slug,
      id,
      label: label ?? String(id),
      zh,
      en,
      rating: rating > 0 ? rating : null,
      difficulty: DIFFICULTIES[difficulty] ?? null,
      premium: premium === 1,
      cnOnly: cnOnly === 1,
      tags: TAG_BITS.filter(([bit]) => (tagBits & bit) !== 0).map(([, tag]) => tag),
    };
    slugByRef.set(cnOnly ? slug : id, slug);
  }
  const slugs = (refs: readonly PlanProblemRef[] | undefined) =>
    (refs ?? []).map((ref) => {
      const slug = slugByRef.get(ref);
      if (!slug) throw new Error(`plan catalog: unknown problem ${ref}`);
      return slug;
    });

  const nodes = new Map<string, PlanCatalogNode>();
  const add = <T extends PlanCatalogNode>(node: T): T => {
    if (nodes.has(node.id)) throw new Error(`plan catalog: duplicate node ${node.id}`);
    nodes.set(node.id, node);
    return node;
  };

  /* Videos and the dictionary sections they teach. */
  const videosFor = new Map<string, string[]>();
  PLAN_VIDEO_ROWS.forEach((video, index) => {
    for (const link of video.links) videosFor.set(link, [...(videosFor.get(link) ?? []), `V${index}`]);
  });
  const course = PLAN_VIDEO_ROWS.map((video, index) =>
    add<PlanCatalogNode>({
      id: `V${index}`,
      kind: "video",
      title: { en: video.en, zh: video.zh },
      videoUrl: video.url,
      problems: slugs(video.p),
      homework: slugs(video.hw),
      children: [],
      links: video.links,
    }),
  );

  /* The dictionary: optional and the core cap carry down, as on the map. */
  const section = (row: PlanSectionRow, parent?: { optional?: boolean; stepCap?: number }): PlanCatalogNode => {
    const optional = row.o === 1 || parent?.optional === true;
    const stepCap = row.cap ?? parent?.stepCap;
    const videos = videosFor.get(row.id);
    const node: PlanCatalogNode = {
      id: row.id,
      kind: row.topic ? "list" : "section",
      title: { en: row.en, zh: row.zh },
      ...(optional ? { optional } : {}),
      ...(row.url ? { url: row.url } : {}),
      problems: slugs(row.p),
      children: (row.c ?? []).map((child) => section(child, { optional, stepCap })),
      ...(row.topic ? { plan: `ling:${row.topic}` } : {}),
      ...(stepCap ? { stepCap } : {}),
      ...(videos ? { videos } : {}),
      ...(row.ref ? { ref: row.ref } : {}),
    };
    return add(node);
  };
  const lists = PLAN_LIST_ROWS.map((row) => section(row));

  /* The core route: each step copies sections, keeping problems under its cap.
     A section that only says "see that list" (§3.7, monotonic stack) brings
     the whole list in, under the same cap. */
  const copy = (source: PlanCatalogNode, cap: number): PlanCatalogNode | null => {
    const target = source.ref ? nodes.get(source.ref) : undefined;
    const viaList = target?.kind === "list" ? target : undefined;
    const children = (viaList ?? source).children
      .map((child) => copy(child, cap))
      .filter((child): child is PlanCatalogNode => child !== null);
    const kept = source.problems.filter((slug) => withinStepCap(problems[slug]!, cap));
    if (kept.length === 0 && children.length === 0) return null;
    return add({
      id: `X${source.id}`,
      kind: "section",
      title: source.title,
      ...(source.optional ? { optional: true } : {}),
      problems: kept,
      children,
      stepCap: cap,
      ...(source.videos ? { videos: source.videos } : {}),
      source: source.id,
      ...(viaList ? { via: viaList.id } : {}),
    });
  };
  const steps: PlanCatalogNode[] = [
    add({
      id: "X0",
      kind: "step",
      title: { en: "Programming basics", zh: "编程入门" },
      url: PRIMER_URL,
      problems: [],
      children: [],
    }),
    ...PLAN_STEP_ROWS.map((step, index) =>
      add<PlanCatalogNode>({
        id: `X${index + 1}`,
        kind: "step",
        title: { en: step.en, zh: step.zh },
        problems: [],
        children: step.secs
          .map((id) => {
            const source = nodes.get(id);
            if (!source) throw new Error(`plan catalog: step ${index + 1} has no section ${id}`);
            return copy(source, step.cap);
          })
          .filter((child): child is PlanCatalogNode => child !== null),
        stepCap: step.cap,
        deepDive: `ling:${step.topic}`,
      }),
    ),
  ];

  /* The frequent lists, each in its own groups. */
  const frequent = PLAN_FREQUENT_ROWS.map((list) => {
    const block = FREQUENT_BLOCKS[list.id];
    if (!block) throw new Error(`plan catalog: unknown list ${list.id}`);
    return add<PlanCatalogNode>({
      id: list.id,
      kind: "block",
      title: { en: block.en, zh: block.zh },
      url: list.url,
      problems: [],
      children: list.g.map((group, index) =>
        add<PlanCatalogNode>({
          id: `${list.id}${index}`,
          kind: "section",
          title: { en: group.en, zh: group.zh },
          problems: slugs(group.p),
          children: [],
        }),
      ),
      plan: block.plan,
      ...(list.id === "N" ? { tagPlans: { nc150: "neetcode-150" } } : {}),
    });
  });

  /* LeetCode's own plans, adding the few problems the map doesn't have. */
  const officialNode = (slug: string, kind: PlanCatalogNodeKind): PlanCatalogNode => {
    const plan = findOfficialStudyPlan(slug);
    const zh = OFFICIAL_TITLES[slug];
    if (!plan || !zh) throw new Error(`plan catalog: no official plan ${slug}`);
    return add<PlanCatalogNode>({
      id: `O:${slug}`,
      kind,
      title: { en: plan.name, zh },
      url: `https://leetcode.com/studyplan/${slug}/`,
      problems: [],
      children: plan.groups.map((group, index) => {
        for (const question of group.questions) {
          problems[question.slug] ??= {
            slug: question.slug,
            id: question.id,
            label: String(question.id),
            zh: question.title,
            en: question.title,
            rating: null,
            difficulty: question.difficulty,
            premium: false,
            cnOnly: false,
            tags: [],
          };
        }
        return add<PlanCatalogNode>({
          id: `O:${slug}.${index}`,
          kind: "section",
          title: { en: group.name, zh: OFFICIAL_GROUP_ZH[group.name] ?? group.name },
          problems: group.questions.map((question) => question.slug),
          children: [],
        });
      }),
      plan: slug,
    });
  };
  const officialTopics = ["dynamic-programming", "graph-theory", "binary-search"].map((slug) =>
    officialNode(slug, "list"),
  );
  const leetcode75 = officialNode("leetcode-75", "block");

  const courseBlock = add<PlanCatalogNode>({
    id: "C",
    kind: "block",
    title: { en: "Algorithm Basics", zh: "基础算法精讲" },
    url: PLAN_COURSE_SOURCE_URL,
    problems: [],
    children: course,
    plan: PLAN_COURSE_SLUG,
  });
  const routeBlock = add<PlanCatalogNode>({
    id: "X",
    kind: "block",
    title: { en: "Core Route", zh: "核心路线" },
    url: PLAN_ROUTE_SOURCE_URL,
    problems: [],
    children: steps,
    plan: PLAN_ROUTE_SLUG,
  });
  const dictionary = add<PlanCatalogNode>({
    id: "G",
    kind: "dictionary",
    title: { en: "Full Lists", zh: "完整题单" },
    problems: [],
    children: [...lists, ...officialTopics],
  });
  const tree = add<PlanCatalogNode>({
    id: "root",
    kind: "root",
    title: { en: "Problem Lists", zh: "刷题清单" },
    problems: [],
    children: [
      add<PlanCatalogNode>({
        id: "gL",
        kind: "group",
        title: { en: "EndlessCheng (灵茶山艾府)", zh: "灵茶山艾府" },
        problems: [],
        children: [courseBlock, routeBlock, dictionary],
      }),
      add<PlanCatalogNode>({
        id: "gH",
        kind: "group",
        title: { en: "High-Frequency Lists", zh: "高频清单" },
        problems: [],
        children: [...frequent, leetcode75],
      }),
    ],
  });

  const nc250 = planNodeSlugs(nodes.get("N")!);
  const hot100 = planNodeSlugs(nodes.get("H")!);
  const top150 = planNodeSlugs(nodes.get("T")!);
  const courseSet = planNodeSlugs(courseBlock);
  const routeSet = planNodeSlugs(routeBlock);
  const sets: PlanListSets = {
    course: courseSet,
    route: routeSet,
    nc150: nc250.filter((slug) => problems[slug]!.tags.includes("nc150")),
    nc250,
    hot100,
    top150,
    main: [...new Set([...courseSet, ...routeSet, ...nc250, ...hot100, ...top150])],
    dictionary: [...new Set(lists.flatMap((list) => planNodeSlugs(list)))],
  };
  return { tree, problems, nodes, sets };
}

let built: Built | null = null;
function catalog(): Built {
  built ??= build();
  return built;
}

/* ── Reading it ── */

/** The tree and its problems, as the page draws them. */
export function planCatalog(): PlanCatalog {
  const { tree, problems } = catalog();
  return { tree, problems };
}

export function planCatalogNode(id: string): PlanCatalogNode | null {
  return catalog().nodes.get(id) ?? null;
}

export function planCatalogProblem(slug: string): PlanCatalogProblem | null {
  return catalog().problems[slug] ?? null;
}

/** Every problem under a node, once each, with a video's homework after its
 *  worked problems. */
export function planNodeSlugs(node: PlanCatalogNode): string[] {
  const seen = new Set<string>();
  const walk = (current: PlanCatalogNode) => {
    for (const slug of current.problems) seen.add(slug);
    for (const slug of current.homework ?? []) seen.add(slug);
    current.children.forEach(walk);
  };
  walk(node);
  return [...seen];
}

/**
 * The problems each meter counts. Without a language, or in Chinese, that
 * includes leetcode.cn-only problems; English users can't open those, so their
 * plans and meters leave them out.
 */
export function planListSets(language?: "en" | "zh"): PlanListSets {
  const { sets, problems } = catalog();
  if (language !== "en") return sets;
  const open = (slugs: readonly string[]) => slugs.filter((slug) => !problems[slug]!.cnOnly);
  return {
    course: open(sets.course),
    route: open(sets.route),
    nc150: open(sets.nc150),
    nc250: open(sets.nc250),
    hot100: open(sets.hot100),
    top150: open(sets.top150),
    main: open(sets.main),
    dictionary: open(sets.dictionary),
  };
}

/** Each set's size, for tests and summaries. */
export function planCatalogSummary(language?: "en" | "zh"): Record<keyof PlanListSets, number> {
  const sets = planListSets(language);
  return {
    course: sets.course.length,
    route: sets.route.length,
    nc150: sets.nc150.length,
    nc250: sets.nc250.length,
    hot100: sets.hot100.length,
    top150: sets.top150.length,
    main: sets.main.length,
    dictionary: sets.dictionary.length,
  };
}

/** Every problem on the map except leetcode.cn-only ones, which can't be
 *  captured from leetcode.com: what add-to-review accepts. */
export function planCatalogReviewSlugs(): string[] {
  return Object.values(catalog().problems)
    .filter((problem) => !problem.cnOnly)
    .map((problem) => problem.slug);
}
