/**
 * Hand-drawn roadmap for Top Interview 150, keyed by LeetCode's group names.
 * `x` is the node's horizontal center as a fraction of the width; `row` is its
 * row, top to bottom. Edges read "builds on", NeetCode-roadmap style. A group
 * LeetCode adds later without a layout entry lands in an extra bottom row.
 */
export const ROADMAP_NODES: Record<string, { x: number; row: number }> = {
  "Array / String": { x: 0.5, row: 0 },
  Hashmap: { x: 0.2, row: 1 },
  "Two Pointers": { x: 0.5, row: 1 },
  Stack: { x: 0.8, row: 1 },
  Matrix: { x: 0.2, row: 2 },
  "Sliding Window": { x: 0.4, row: 2 },
  "Binary Search": { x: 0.6, row: 2 },
  "Linked List": { x: 0.8, row: 2 },
  "Binary Tree General": { x: 0.7, row: 3 },
  Heap: { x: 0.2, row: 4 },
  "Binary Tree BFS": { x: 0.4, row: 4 },
  "Binary Search Tree": { x: 0.6, row: 4 },
  Trie: { x: 0.8, row: 4 },
  Intervals: { x: 0.2, row: 5 },
  "Graph General": { x: 0.4, row: 5 },
  Backtracking: { x: 0.8, row: 5 },
  "Graph BFS": { x: 0.4, row: 6 },
  "Divide & Conquer": { x: 0.6, row: 6 },
  "1D DP": { x: 0.8, row: 6 },
  "Bit Manipulation": { x: 0.2, row: 7 },
  "Kadane's Algorithm": { x: 0.6, row: 7 },
  "Multidimensional DP": { x: 0.8, row: 7 },
  Math: { x: 0.2, row: 8 },
};

export const ROADMAP_EDGES: readonly (readonly [string, string])[] = [
  ["Array / String", "Hashmap"],
  ["Array / String", "Two Pointers"],
  ["Array / String", "Stack"],
  ["Hashmap", "Matrix"],
  ["Two Pointers", "Sliding Window"],
  ["Two Pointers", "Binary Search"],
  ["Two Pointers", "Linked List"],
  ["Binary Search", "Binary Tree General"],
  ["Linked List", "Binary Tree General"],
  ["Binary Tree General", "Heap"],
  ["Binary Tree General", "Binary Tree BFS"],
  ["Binary Tree General", "Binary Search Tree"],
  ["Binary Tree General", "Trie"],
  ["Heap", "Intervals"],
  ["Binary Tree BFS", "Graph General"],
  ["Trie", "Backtracking"],
  ["Graph General", "Graph BFS"],
  ["Backtracking", "Divide & Conquer"],
  ["Backtracking", "1D DP"],
  ["1D DP", "Bit Manipulation"],
  ["1D DP", "Kadane's Algorithm"],
  ["1D DP", "Multidimensional DP"],
  ["Bit Manipulation", "Math"],
];

/** Layout for the given groups, with unknown groups spread over a new last row. */
export function roadmapLayout(groupNames: readonly string[]) {
  const lastRow = Math.max(...Object.values(ROADMAP_NODES).map((node) => node.row));
  const unknown = groupNames.filter((name) => !ROADMAP_NODES[name]);
  const positions = new Map<string, { x: number; row: number }>();
  for (const name of groupNames) {
    const known = ROADMAP_NODES[name];
    if (known) positions.set(name, known);
  }
  unknown.forEach((name, index) => positions.set(name, { x: (index + 1) / (unknown.length + 1), row: lastRow + 1 }));
  return {
    positions,
    rows: lastRow + 1 + (unknown.length > 0 ? 1 : 0),
    edges: ROADMAP_EDGES.filter(([from, to]) => positions.has(from) && positions.has(to)),
  };
}
