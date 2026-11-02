import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PLAN_FREQUENT_ROWS,
  PLAN_LIST_ROWS,
  PLAN_PROBLEM_ROWS,
  PLAN_STEP_ROWS,
  PLAN_VIDEO_ROWS,
} from "./plan-catalog.generated";
import {
  planCatalog,
  planCatalogNode,
  planCatalogProblem,
  planCatalogReviewSlugs,
  planCatalogSummary,
  planListSets,
  planNodeSlugs,
  withinStepCap,
  type PlanCatalogNode,
} from "./plan-catalog";
import { OFFICIAL_STUDY_PLANS } from "./study-plans";

const here = dirname(fileURLToPath(import.meta.url));
const { tree, problems } = planCatalog();

function walk(node: PlanCatalogNode, visit: (node: PlanCatalogNode) => void) {
  visit(node);
  node.children.forEach((child) => walk(child, visit));
}
const allNodes: PlanCatalogNode[] = [];
walk(tree, (node) => allNodes.push(node));
const node = (id: string) => planCatalogNode(id)!;

describe("plan catalog numbers", () => {
  it("matches the map's list sizes", () => {
    expect(planCatalogSummary()).toEqual({
      course: 172,
      route: 459,
      nc150: 150,
      nc250: 250,
      hot100: 100,
      top150: 150,
      main: 721,
      dictionary: 2828,
    });
  });

  it("cuts the route's seven steps to the map's sizes", () => {
    const steps = node("X").children;
    expect(steps.map((step) => step.id)).toEqual(["X0", "X1", "X2", "X3", "X4", "X5", "X6", "X7"]);
    expect(steps.slice(1).map((step) => planNodeSlugs(step).length)).toEqual([48, 16, 165, 74, 17, 35, 117]);
    expect(steps.slice(1).map((step) => step.stepCap)).toEqual([1700, 1700, 1700, 1700, 1700, 1700, 2000]);
    expect(planListSets().route.filter((slug) => problems[slug]!.cnOnly)).toHaveLength(22);
  });

  it("leaves leetcode.cn-only problems out of English meters", () => {
    const en = planCatalogSummary("en");
    expect(en.route).toBe(437);
    expect(en.course).toBe(172);
    expect(en.nc250).toBe(250);
    expect(en.main).toBe(721 - 22);
    expect(planListSets("en").main.some((slug) => problems[slug]!.cnOnly)).toBe(false);
  });
});

describe("the tree", () => {
  it("has the map's shape", () => {
    expect(tree.children.map((group) => group.id)).toEqual(["gL", "gH"]);
    expect(node("gL").children.map((block) => block.id)).toEqual(["C", "X", "G"]);
    expect(node("gH").children.map((block) => block.id)).toEqual(["N", "H", "T", "O:leetcode-75"]);
    expect(node("C").children).toHaveLength(27);
    expect(node("G").children.map((list) => list.id)).toEqual([
      ...Array.from({ length: 12 }, (_, index) => `L${index}`),
      "O:dynamic-programming",
      "O:graph-theory",
      "O:binary-search",
    ]);
    expect(node("N").children).toHaveLength(18);
    expect(node("H").children).toHaveLength(17);
    expect(node("T").children).toHaveLength(23);
  });

  it("has a unique id and an English and a Chinese name on every node", () => {
    const ids = allNodes.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const candidate of allNodes) {
      expect(candidate.title.en.trim(), candidate.id).not.toBe("");
      expect(candidate.title.zh.trim(), candidate.id).not.toBe("");
    }
  });

  it("names every official group in Chinese", () => {
    for (const candidate of allNodes.filter((entry) => entry.id.startsWith("O:") && entry.id.includes("."))) {
      expect(/\p{Script=Han}|^BFS$/u.test(candidate.title.zh), candidate.title.zh).toBe(true);
    }
  });

  it("keeps § numbering in the English names", () => {
    walk(node("G"), (section) => {
      const number = /^§[\d.]+/.exec(section.title.zh)?.[0];
      if (number) expect(section.title.en.startsWith(`${number} `), section.id).toBe(true);
    });
  });

  it("only references known problems", () => {
    for (const candidate of allNodes) {
      for (const slug of [...candidate.problems, ...(candidate.homework ?? [])]) {
        expect(problems[slug], `${candidate.id}: ${slug}`).toBeDefined();
      }
    }
  });

  it("links step 0 out and carries no problems there", () => {
    expect(node("X0")).toMatchObject({
      kind: "step",
      title: { en: "Programming basics", zh: "编程入门" },
      url: "https://leetcode.cn/studyplan/primers-list/",
      problems: [],
      children: [],
    });
  });

  it("cuts each route section from the dictionary under its cap", () => {
    walk(node("X"), (section) => {
      if (section.kind !== "section") return;
      const source = node(section.source!);
      expect(section.title).toEqual(source.title);
      expect(section.problems).toEqual(
        source.problems.filter((slug) => withinStepCap(problems[slug]!, section.stepCap!)),
      );
    });
  });

  it("brings the monotonic stack list inside step 3 through §3.7", () => {
    const stack = node("XL7.3.6");
    expect(stack).toMatchObject({ source: "L7.3.6", via: "L2", stepCap: 1700 });
    expect(stack.children.map((child) => child.source)).toEqual(expect.arrayContaining(["L2.0"]));
    expect(stack.children.every((child) => child.source?.startsWith("L2."))).toBe(true);
    expect(planNodeSlugs(node("X3"))).toEqual(expect.arrayContaining(planNodeSlugs(stack)));
    // The dictionary's §3.7 only points at the list.
    expect(node("L7.3.6")).toMatchObject({ ref: "L2", problems: [] });
  });

  it("marks dictionary sections on the route with their cap, and carries optional down", () => {
    expect(node("L0.0.0").stepCap).toBe(1700);
    expect(node("L6.0.0").stepCap).toBe(2000);
    expect(node("L2.0.0").stepCap).toBe(1700);
    expect(node("L1.1").stepCap).toBeUndefined();
    expect(node("L0.0.1").optional).toBe(true);
    expect(node("L0.0.0").optional).toBeUndefined();
    expect(node("L6.1.1").optional).toBe(true);
  });

  it("keeps videos' homework and links, and points sections back at their videos", () => {
    const video = node("V0");
    expect(video).toMatchObject({ kind: "video", videoUrl: "https://www.bilibili.com/video/BV1bP411c7oJ/", links: ["L0.2.1"] });
    expect(video.problems).toHaveLength(2);
    expect(video.homework).toHaveLength(4);
    for (const candidate of node("C").children) {
      for (const link of candidate.links!) {
        expect(node(link).videos, `${candidate.id} -> ${link}`).toContain(candidate.id);
      }
    }
    expect(node("L0.2.1").videos).toEqual(["V0", "V1"]);
    expect(node("XL0.1").videos).toEqual(["V2"]);
  });

  it("names the plan each block and list switches to", () => {
    expect(node("C").plan).toBe("ling:course");
    expect(node("X").plan).toBe("ling:route");
    expect(node("L0").plan).toBe("ling:sliding-window");
    expect(node("L4").plan).toBe("ling:bits");
    expect(node("L6").plan).toBe("ling:dp");
    expect(node("L11").plan).toBe("ling:strings");
    expect(node("N")).toMatchObject({ plan: "neetcode-250", tagPlans: { nc150: "neetcode-150" } });
    expect(node("H").plan).toBe("top-100-liked");
    expect(node("T").plan).toBe("top-interview-150");
    expect(node("O:leetcode-75").plan).toBe("leetcode-75");
    expect(node("O:graph-theory").plan).toBe("graph-theory");
    expect(node("G").plan).toBeUndefined();
    expect(node("X1").deepDive).toBe("ling:sliding-window");
    expect(node("X7").deepDive).toBe("ling:dp");
  });
});

describe("problems", () => {
  it("has unique slugs and consistent cn-only fields", () => {
    const slugs = PLAN_PROBLEM_ROWS.map((row) => row[0]);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(Object.keys(problems).length).toBeGreaterThanOrEqual(slugs.length);
    expect(planCatalogProblem("two-sum")).toEqual({
      slug: "two-sum",
      id: 1,
      label: "1",
      zh: "两数之和",
      en: "Two Sum",
      rating: null,
      difficulty: "Easy",
      premium: false,
      cnOnly: false,
      tags: ["nc150", "nc250", "hot100", "top150"],
    });
    const cnOnly = Object.values(problems).filter((problem) => problem.cnOnly);
    expect(cnOnly).toHaveLength(90);
    for (const problem of cnOnly) {
      expect(problem).toMatchObject({ id: 0, en: "", difficulty: null });
      expect(problem.label).not.toBe("0");
      expect(problem.label.trim()).not.toBe("");
    }
    expect(planCatalogProblem("not-a-problem")).toBeNull();
  });

  it("includes every official plan problem", () => {
    for (const plan of OFFICIAL_STUDY_PLANS) {
      for (const group of plan.groups) {
        for (const question of group.questions) {
          expect(problems[question.slug], `${plan.slug}: ${question.slug}`).toBeDefined();
        }
      }
    }
  });

  it("offers only problems leetcode.com can open for review", () => {
    const review = new Set(planCatalogReviewSlugs());
    expect(review.has("two-sum")).toBe(true);
    expect(review.has("kids-with-the-greatest-number-of-candies")).toBe(true);
    expect([...review].some((slug) => problems[slug]!.cnOnly)).toBe(false);
    expect(review.size).toBe(Object.keys(problems).length - 90);
  });

  it("applies a step's cap by rating, or by difficulty when unrated", () => {
    const base = { ...planCatalogProblem("two-sum")!, premium: false };
    expect(withinStepCap({ ...base, rating: 1700 }, 1700)).toBe(true);
    expect(withinStepCap({ ...base, rating: 1701 }, 1700)).toBe(false);
    expect(withinStepCap({ ...base, rating: null, difficulty: "Hard" }, 1700)).toBe(false);
    expect(withinStepCap({ ...base, rating: null, difficulty: null }, 1700)).toBe(true);
    expect(withinStepCap({ ...base, rating: 1200, premium: true }, 1700)).toBe(false);
  });
});

describe("generated data", () => {
  const ALLOWED = {
    section: new Set(["id", "zh", "en", "o", "cap", "ref", "p", "c", "topic", "url", "updated"]),
    video: new Set(["zh", "en", "url", "p", "hw", "links"]),
    step: new Set(["zh", "en", "topic", "cap", "secs"]),
    frequent: new Set(["id", "zh", "url", "g"]),
    group: new Set(["zh", "en", "p"]),
  };
  const expectOnly = (row: object, allowed: Set<string>) => {
    for (const key of Object.keys(row)) expect(allowed.has(key), key).toBe(true);
  };

  it("dates each of his lists by its source post", () => {
    for (const list of PLAN_LIST_ROWS) expect(list.updated, list.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps structure only: no prose fields, video ids, or Blind 75", () => {
    const visit = (row: (typeof PLAN_LIST_ROWS)[number]) => {
      expectOnly(row, ALLOWED.section);
      row.c?.forEach(visit);
    };
    PLAN_LIST_ROWS.forEach(visit);
    PLAN_VIDEO_ROWS.forEach((row) => expectOnly(row, ALLOWED.video));
    PLAN_STEP_ROWS.forEach((row) => expectOnly(row, ALLOWED.step));
    for (const row of PLAN_FREQUENT_ROWS) {
      expectOnly(row, ALLOWED.frequent);
      row.g.forEach((group) => expectOnly(group, ALLOWED.group));
    }
    expect(PLAN_PROBLEM_ROWS.every((row) => row[8] < 16)).toBe(true);
  });

  it("names its source and says not to edit it", () => {
    const head = readFileSync(resolve(here, "plan-catalog.generated.ts"), "utf8").slice(0, 400);
    expect(head).toContain("scripts/sync-plan-catalog.mjs");
    expect(head).toContain("Do not");
  });

  it("is never imported from the package's main entry", () => {
    expect(readFileSync(resolve(here, "index.ts"), "utf8")).not.toContain("plan-catalog");
  });
});
