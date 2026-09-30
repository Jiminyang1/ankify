/**
 * LeetCode topic tags, keyed by slug.
 *
 * Problems store tag slugs, not display names: LeetCode renames tags without
 * changing the slug ("Graph" → "Graph Theory" is still `graph`), so slugs are
 * the only key that joins older and newer captures of the same tag.
 */

export interface LeetcodeTag {
  slug: string;
  name: string;
}

export const LEETCODE_TAGS: readonly LeetcodeTag[] = [
  { slug: "array", name: "Array" },
  { slug: "string", name: "String" },
  { slug: "two-pointers", name: "Two Pointers" },
  { slug: "sorting", name: "Sorting" },
  { slug: "stack", name: "Stack" },
  { slug: "queue", name: "Queue" },
  { slug: "linked-list", name: "Linked List" },
  { slug: "matrix", name: "Matrix" },
  { slug: "simulation", name: "Simulation" },
  { slug: "enumeration", name: "Enumeration" },
  { slug: "counting", name: "Counting" },
  { slug: "hash-table", name: "Hash Table" },
  { slug: "math", name: "Math" },
  { slug: "binary-search", name: "Binary Search" },
  { slug: "sliding-window", name: "Sliding Window" },
  { slug: "prefix-sum", name: "Prefix Sum" },
  { slug: "greedy", name: "Greedy" },
  { slug: "heap-priority-queue", name: "Heap (Priority Queue)" },
  { slug: "tree", name: "Tree" },
  { slug: "binary-tree", name: "Binary Tree" },
  { slug: "binary-search-tree", name: "Binary Search Tree" },
  { slug: "depth-first-search", name: "Depth-First Search" },
  { slug: "breadth-first-search", name: "Breadth-First Search" },
  { slug: "graph", name: "Graph Theory" },
  { slug: "recursion", name: "Recursion" },
  { slug: "bit-manipulation", name: "Bit Manipulation" },
  { slug: "design", name: "Design" },
  { slug: "doubly-linked-list", name: "Doubly-Linked List" },
  { slug: "ordered-set", name: "Ordered Set" },
  { slug: "ordered-map", name: "Ordered Map" },
  { slug: "merge-sort", name: "Merge Sort" },
  { slug: "bucket-sort", name: "Bucket Sort" },
  { slug: "counting-sort", name: "Counting Sort" },
  { slug: "radix-sort", name: "Radix Sort" },
  { slug: "geometry", name: "Geometry" },
  { slug: "iterator", name: "Iterator" },
  { slug: "randomized", name: "Randomized" },
  { slug: "brainteaser", name: "Brainteaser" },
  { slug: "interactive", name: "Interactive" },
  { slug: "database", name: "Database" },
  { slug: "shell", name: "Shell" },
  { slug: "dynamic-programming", name: "Dynamic Programming" },
  { slug: "memoization", name: "Memoization" },
  { slug: "knapsack-problem", name: "Knapsack Problem" },
  { slug: "0-1-knapsack", name: "0-1 Knapsack" },
  { slug: "complete-knapsack", name: "Complete Knapsack" },
  { slug: "backtracking", name: "Backtracking" },
  { slug: "divide-and-conquer", name: "Divide and Conquer" },
  { slug: "union-find", name: "Union-Find" },
  { slug: "topological-sort", name: "Topological Sort" },
  { slug: "shortest-path", name: "Shortest Path" },
  { slug: "minimum-spanning-tree", name: "Minimum Spanning Tree" },
  { slug: "eulerian-circuit", name: "Eulerian Circuit" },
  { slug: "biconnected-component", name: "Biconnected Component" },
  { slug: "strongly-connected-component", name: "Strongly Connected Component" },
  { slug: "bidirectional-search", name: "Bidirectional Search" },
  { slug: "trie", name: "Trie" },
  { slug: "monotonic-stack", name: "Monotonic Stack" },
  { slug: "monotonic-queue", name: "Monotonic Queue" },
  { slug: "segment-tree", name: "Segment Tree" },
  { slug: "binary-indexed-tree", name: "Binary Indexed Tree" },
  { slug: "quickselect", name: "Quickselect" },
  { slug: "data-stream", name: "Data Stream" },
  { slug: "sweep-line", name: "Sweep Line" },
  { slug: "rolling-hash", name: "Rolling Hash" },
  { slug: "hash-function", name: "Hash Function" },
  { slug: "string-matching", name: "String Matching" },
  { slug: "suffix-array", name: "Suffix Array" },
  { slug: "bitmask", name: "Bitmask" },
  { slug: "number-theory", name: "Number Theory" },
  { slug: "combinatorics", name: "Combinatorics" },
  { slug: "probability-and-statistics", name: "Probability and Statistics" },
  { slug: "game-theory", name: "Game Theory" },
  { slug: "minimax-algorithm", name: "Minimax" },
  { slug: "meet-in-the-middle", name: "Meet in the Middle" },
  { slug: "reservoir-sampling", name: "Reservoir Sampling" },
  { slug: "rejection-sampling", name: "Rejection Sampling" },
  { slug: "concurrency", name: "Concurrency" },
];

/** Retired slugs LeetCode merged into another tag. Renamed tags ("Graph",
 *  "Union Find") need no entry: their old names slugify to the same slug. */
const MERGED_SLUGS: Record<string, string> = {
  heap: "heap-priority-queue",
};

const BY_SLUG = new Map(LEETCODE_TAGS.map((tag) => [tag.slug, tag]));
const BY_NAME = new Map(LEETCODE_TAGS.map((tag) => [tag.name.toLowerCase(), tag.slug]));

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Canonical slug for a tag given either its slug or any past display name. */
export function leetcodeTagSlug(value: string): string {
  const trimmed = value.trim();
  if (BY_SLUG.has(trimmed)) return trimmed;
  const slug = BY_NAME.get(trimmed.toLowerCase()) ?? slugify(trimmed);
  return MERGED_SLUGS[slug] ?? slug;
}

/** Canonical slugs, de-duplicated, in first-seen order. Empty values drop. */
export function normalizeLeetcodeTags(values: readonly string[]): string[] {
  const slugs = values.map(leetcodeTagSlug).filter(Boolean);
  return [...new Set(slugs)];
}

/** Current display name. Unknown slugs (tags LeetCode added after this list)
 *  are title-cased from the slug. */
export function leetcodeTagName(value: string): string {
  const slug = leetcodeTagSlug(value);
  const known = BY_SLUG.get(slug);
  if (known) return known.name;
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
