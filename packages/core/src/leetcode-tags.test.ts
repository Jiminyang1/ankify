import { describe, expect, it } from "vitest";
import {
  LEETCODE_TAGS,
  leetcodeTagName,
  leetcodeTagSlug,
  normalizeLeetcodeTags,
} from "./leetcode-tags";

describe("LeetCode tag catalog", () => {
  it("has unique slugs and names", () => {
    expect(new Set(LEETCODE_TAGS.map((tag) => tag.slug)).size).toBe(LEETCODE_TAGS.length);
    expect(new Set(LEETCODE_TAGS.map((tag) => tag.name.toLowerCase())).size).toBe(LEETCODE_TAGS.length);
  });

  it("maps current names, old names, and slugs to one slug", () => {
    expect(leetcodeTagSlug("graph")).toBe("graph");
    expect(leetcodeTagSlug("Graph")).toBe("graph");
    expect(leetcodeTagSlug("Graph Theory")).toBe("graph");
    expect(leetcodeTagSlug("Union Find")).toBe("union-find");
    expect(leetcodeTagSlug("Union-Find")).toBe("union-find");
    expect(leetcodeTagSlug("Heap (Priority Queue)")).toBe("heap-priority-queue");
    expect(leetcodeTagSlug("Heap")).toBe("heap-priority-queue");
    expect(leetcodeTagSlug("Minimax")).toBe("minimax-algorithm");
    expect(leetcodeTagSlug(" Depth-First Search ")).toBe("depth-first-search");
  });

  it("slugifies tags it has never seen", () => {
    expect(leetcodeTagSlug("Multi-Source BFS")).toBe("multi-source-bfs");
    expect(leetcodeTagName("multi-source-bfs")).toBe("Multi Source Bfs");
  });

  it("shows the current name for old names and slugs", () => {
    expect(leetcodeTagName("graph")).toBe("Graph Theory");
    expect(leetcodeTagName("Union Find")).toBe("Union-Find");
    expect(leetcodeTagName("heap-priority-queue")).toBe("Heap (Priority Queue)");
  });

  it("normalizes a tag list without duplicates", () => {
    expect(normalizeLeetcodeTags(["Graph", "graph", "Graph Theory", "Array", " "])).toEqual(["graph", "array"]);
  });
});
