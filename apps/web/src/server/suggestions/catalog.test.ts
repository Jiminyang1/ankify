import { describe, expect, it } from "vitest";
import committed from "./catalog.json";
import { catalogCandidates, parseCatalog } from "./catalog";

describe("suggestion catalog", () => {
  it("parses the committed catalog, and suggests nothing from one that was never generated", () => {
    expect(() => parseCatalog(committed)).not.toThrow();
    if (committed.generatedAt === null) expect(catalogCandidates()).toEqual([]);
    expect(parseCatalog({ generatedAt: null, rule: null, entries: [{ slug: "two-sum", title: "Two Sum", difficulty: "Easy", topicTags: [] }] })).toEqual([]);
  });

  it("stamps entries with the generation time, keeps each slug once, and rejects anything else", () => {
    const generatedAt = "2026-09-30T12:00:00.000Z";
    const entry = { slug: "two-sum", title: "Two Sum", difficulty: "Easy", topicTags: ["Array", "Hash Table"] };
    expect(parseCatalog({ generatedAt, rule: "first free per topic", entries: [entry, { ...entry, title: "Duplicate" }] })).toEqual([
      { ...entry, paidOnly: false, source: "catalog", verifiedAt: new Date(generatedAt) },
    ]);
    for (const invalid of [{ ...entry, difficulty: "Hard" }, { ...entry, slug: "Two Sum" }, { ...entry, paidOnly: false }, { ...entry, title: "" }]) {
      expect(() => parseCatalog({ generatedAt, rule: null, entries: [invalid] })).toThrow();
    }
  });
});
