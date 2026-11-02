import type { PlanStatusEntryDto } from "@ankify/contracts";
import { leetcodeProblemUrl, type LeetcodeSite } from "@ankify/core/leetcode-site";
import type {
  PlanCatalog,
  PlanCatalogNode,
  PlanCatalogProblem,
  PlanCatalogTag,
} from "@ankify/core/plan-catalog";

/**
 * The Plan page's map, list, and route views as pure functions over the catalog:
 * indexing the tree, filtering it, and working out what opens. No React, so
 * it's tested directly and server components can read the view names.
 */

export const PLAN_VIEWS = ["plan", "map", "list", "route"] as const;
export type PlanView = (typeof PLAN_VIEWS)[number];

export function parsePlanView(value: unknown): PlanView {
  return PLAN_VIEWS.includes(value as PlanView) ? (value as PlanView) : "plan";
}

export type PlanStatuses = Readonly<Record<string, PlanStatusEntryDto>>;
export type PlanSite = LeetcodeSite;
export type PlanLanguage = "en" | "zh";

/* ── Indexing the tree ── */

export type PlanIndex = {
  catalog: PlanCatalog;
  nodes: ReadonlyMap<string, PlanCatalogNode>;
  parents: ReadonlyMap<string, string>;
  /** Every problem under a node, once each. */
  subtree: ReadonlyMap<string, readonly string[]>;
  /** The first lesson that uses a problem. */
  videoOf: ReadonlyMap<string, PlanCatalogNode>;
  /** The node "set as current" switches to a plan from. */
  planNode: ReadonlyMap<string, PlanCatalogNode>;
};

export function buildPlanIndex(catalog: PlanCatalog): PlanIndex {
  const nodes = new Map<string, PlanCatalogNode>();
  const parents = new Map<string, string>();
  const subtree = new Map<string, readonly string[]>();
  const videoOf = new Map<string, PlanCatalogNode>();
  const planNode = new Map<string, PlanCatalogNode>();

  const walk = (node: PlanCatalogNode): readonly string[] => {
    nodes.set(node.id, node);
    if (node.plan) planNode.set(node.plan, node);
    const own = [...node.problems, ...(node.homework ?? [])];
    if (node.kind === "video") {
      for (const slug of own) if (!videoOf.has(slug)) videoOf.set(slug, node);
    }
    const seen = new Set(own);
    for (const child of node.children) {
      parents.set(child.id, node.id);
      for (const slug of walk(child)) seen.add(slug);
    }
    const slugs = [...seen];
    subtree.set(node.id, slugs);
    return slugs;
  };
  walk(catalog.tree);
  return { catalog, nodes, parents, subtree, videoOf, planNode };
}

/** A node and its ancestors, nearest first. */
export function pathToRoot(index: PlanIndex, id: string): string[] {
  const path: string[] = [];
  for (let current: string | undefined = id; current; current = index.parents.get(current)) path.push(current);
  return path;
}

/* ── Which lists a view shows ── */

export const PLAN_ONLY = ["all", "course", "core", "nc150", "nc250", "hot100", "top150", "lc75", "dictionary"] as const;
export type PlanOnly = (typeof PLAN_ONLY)[number];

export function parsePlanOnly(value: unknown): PlanOnly | null {
  return PLAN_ONLY.includes(value as PlanOnly) ? (value as PlanOnly) : null;
}

const ONLY_NODE: Record<Exclude<PlanOnly, "all">, string> = {
  course: "C",
  core: "X",
  nc150: "N",
  nc250: "N",
  hot100: "H",
  top150: "T",
  lc75: "O:leetcode-75",
  dictionary: "G",
};

/** The node a scope shows, or null when it shows everything. */
export function planOnlyNode(only: PlanOnly): string | null {
  return only === "all" ? null : ONLY_NODE[only];
}

/** The block holding NeetCode, whose NC150 toggle swaps the plan it sets. */
export const NEETCODE_BLOCK = "N";

/** A block's own list tag says nothing on its own rows. */
export const PLAN_BLOCK_TAG: Readonly<Record<string, PlanCatalogTag>> = { N: "nc250", H: "hot100", T: "top150" };

/** The list a meter or chip opens at a section. */
export function planSectionHref(id: string): string {
  return `/profile?view=list&section=${encodeURIComponent(id)}`;
}

export type PlanListGroup = {
  key: "ling" | "frequent" | "dictionary";
  blocks: readonly PlanCatalogNode[];
  /** One list on its own: it starts open. */
  single: boolean;
};

function node(index: PlanIndex, id: string): PlanCatalogNode {
  const found = index.nodes.get(id);
  if (!found) throw new Error(`plan map: no node ${id}`);
  return found;
}

export function planListGroups(index: PlanIndex, only: PlanOnly): PlanListGroup[] {
  const ling = { key: "ling", blocks: [node(index, "C"), node(index, "X")], single: false } as const;
  const frequent = {
    key: "frequent",
    blocks: ["N", "H", "T", "O:leetcode-75"].map((id) => node(index, id)),
    single: false,
  } as const;
  const dictionary = { key: "dictionary", blocks: node(index, "G").children, single: false } as const;
  switch (only) {
    case "all":
      return [ling, frequent, dictionary];
    case "dictionary":
      return [dictionary];
    case "course":
    case "core":
      return [{ key: "ling", blocks: [node(index, ONLY_NODE[only])], single: true }];
    default:
      return [{ key: "frequent", blocks: [node(index, ONLY_NODE[only])], single: true }];
  }
}

/** Whether `id` is on screen under this scope. */
export function isInScope(index: PlanIndex, id: string, only: PlanOnly): boolean {
  if (only === "all") return true;
  return pathToRoot(index, id).includes(ONLY_NODE[only]);
}

/* ── Filters ── */

export type PlanFilters = {
  q: string;
  tag: PlanCatalogTag | "";
  cap: number;
  hidePremium: boolean;
  hideDone: boolean;
  onlyDue: boolean;
};

export const NO_FILTERS: PlanFilters = { q: "", tag: "", cap: 0, hidePremium: false, hideDone: false, onlyDue: false };
export const PLAN_CAPS = [1400, 1700, 2000, 2400] as const;
export const PLAN_TAGS: readonly PlanCatalogTag[] = ["nc150", "nc250", "hot100", "top150"];

export function filtersActive(filters: PlanFilters): boolean {
  return Boolean(
    filters.q.trim() || filters.tag || filters.cap || filters.hidePremium || filters.hideDone || filters.onlyDue,
  );
}

/** Restores saved filters, ignoring anything that isn't one. */
export function sanitizeFilters(value: unknown): PlanFilters {
  const saved = (value ?? {}) as Partial<Record<keyof PlanFilters, unknown>>;
  return {
    q: typeof saved.q === "string" ? saved.q : "",
    tag: PLAN_TAGS.includes(saved.tag as PlanCatalogTag) ? (saved.tag as PlanCatalogTag) : "",
    cap: PLAN_CAPS.includes(saved.cap as (typeof PLAN_CAPS)[number]) ? (saved.cap as number) : 0,
    hidePremium: saved.hidePremium === true,
    hideDone: saved.hideDone === true,
    onlyDue: saved.onlyDue === true,
  };
}

export const normalizePlanQuery = (text: string) => text.toLowerCase().replace(/\s+/g, "");
const normalize = normalizePlanQuery;

export function matchesPlanProblem(problem: PlanCatalogProblem, query: string): boolean {
  if (/^\d+$/.test(query)) return String(problem.id) === query;
  return normalize(problem.zh).includes(query) || normalize(problem.en).includes(query) || normalize(problem.label).includes(query);
}

function passesFilters(problem: PlanCatalogProblem, filters: PlanFilters, statuses: PlanStatuses): boolean {
  if (filters.tag && !problem.tags.includes(filters.tag)) return false;
  if (filters.cap && (problem.rating != null ? problem.rating > filters.cap : problem.difficulty === "Hard")) return false;
  if (filters.hidePremium && problem.premium) return false;
  const entry = statuses[problem.slug];
  if (filters.hideDone && entry) return false;
  if (filters.onlyDue && entry?.status !== "due") return false;
  return true;
}

/** English plans leave leetcode.cn-only problems out, unless the user reads
 *  problems on leetcode.cn; the meters count the same way. */
export function isVisibleProblem(problem: PlanCatalogProblem, language: PlanLanguage, site: PlanSite): boolean {
  return language === "zh" || site === "cn" || !problem.cnOnly;
}

/** Sections, lists, lessons, and steps are searchable by name; the tree's
 *  scaffolding isn't, or a word in its title would match everything. */
export function hasSearchableTitle(candidate: PlanCatalogNode): boolean {
  return candidate.kind !== "root" && candidate.kind !== "group" && candidate.kind !== "dictionary";
}

export type PlanNodeState = {
  /** This node's own rows after filters. On a lesson, the ones in the video. */
  rows: readonly string[];
  homework: readonly string[];
  /** Filtered problems under this node, once each. */
  matched: ReadonlySet<string>;
  /** Unfiltered problems under this node, once each, and how many are solved. */
  all: ReadonlySet<string>;
  solved: number;
};

/**
 * The list view's numbers and rows for every node. A search that names a
 * section keeps that section's problems; other filters still apply to them.
 * `nc150Block` narrows the NeetCode block to its NC150 problems.
 */
export function computePlanList(input: {
  index: PlanIndex;
  filters: PlanFilters;
  statuses: PlanStatuses;
  language: PlanLanguage;
  site: PlanSite;
  nc150Block?: boolean;
}): ReadonlyMap<string, PlanNodeState> {
  const { index, filters, statuses, language, site, nc150Block = false } = input;
  const { problems } = index.catalog;
  const query = normalize(filters.q);
  const numeric = /^\d+$/.test(query);
  const states = new Map<string, PlanNodeState>();

  const walk = (current: PlanCatalogNode, nameHit: boolean, inNc150: boolean) => {
    const hit =
      nameHit ||
      (query.length > 0 &&
        !numeric &&
        hasSearchableTitle(current) &&
        (normalize(current.title.en).includes(query) || normalize(current.title.zh).includes(query)));
    const narrow = inNc150 || (nc150Block && current.id === NEETCODE_BLOCK);
    const visible = (slug: string) => {
      const problem = problems[slug];
      if (!problem || !isVisibleProblem(problem, language, site)) return false;
      return !narrow || problem.tags.includes("nc150");
    };
    const keep = (slug: string) => {
      const problem = problems[slug]!;
      return (!query || hit || matchesPlanProblem(problem, query)) && passesFilters(problem, filters, statuses);
    };

    const ownAll = new Set([...current.problems, ...(current.homework ?? [])].filter(visible));
    const worked = new Set(current.problems.filter((slug) => ownAll.has(slug) && keep(slug)));
    const homework = new Set((current.homework ?? []).filter((slug) => ownAll.has(slug) && keep(slug) && !worked.has(slug)));
    const matched = new Set([...worked, ...homework]);
    const all = ownAll;
    for (const child of current.children) {
      const childState = walk(child, hit, narrow);
      for (const slug of childState.matched) matched.add(slug);
      for (const slug of childState.all) all.add(slug);
    }
    let solved = 0;
    for (const slug of all) if (statuses[slug]) solved += 1;
    const state: PlanNodeState = { rows: [...worked], homework: [...homework], matched, all, solved };
    states.set(current.id, state);
    return state;
  };
  walk(index.catalog.tree, false, false);
  return states;
}

/** How many problems are in these lists for this reader, once each. */
export function visibleCount(index: PlanIndex, ids: readonly string[], language: PlanLanguage, site: PlanSite): number {
  const seen = new Set<string>();
  for (const id of ids) {
    for (const slug of index.subtree.get(id) ?? []) {
      const problem = index.catalog.problems[slug];
      if (problem && isVisibleProblem(problem, language, site)) seen.add(slug);
    }
  }
  return seen.size;
}

/**
 * While filtering, sections open by themselves so matches show. There can be
 * thousands of rows, so opening stops after `cap` rows; the rest stay closed
 * with their match counts.
 */
export function autoOpenMatches(
  roots: readonly PlanCatalogNode[],
  states: ReadonlyMap<string, PlanNodeState>,
  cap: number,
): { open: ReadonlySet<string>; rendered: number; rows: number; unique: number } {
  const open = new Set<string>();
  const unique = new Set<string>();
  let rendered = 0;
  let rows = 0;
  const walk = (current: PlanCatalogNode) => {
    const state = states.get(current.id);
    if (!state || state.matched.size === 0) return;
    const own = state.rows.length + state.homework.length;
    rows += own;
    if (rendered < cap) {
      open.add(current.id);
      rendered += own;
    }
    current.children.forEach(walk);
  };
  for (const root of roots) {
    for (const slug of states.get(root.id)?.matched ?? []) unique.add(slug);
    walk(root);
  }
  return { open, rendered, rows, unique: unique.size };
}

/** Whether a node starts open with no filter on: lists are closed unless shown
 *  alone, chapters are closed, and what's inside a chapter is open. */
export function defaultOpen(level: number, single: boolean): boolean {
  if (level === 0) return single;
  return level > 1;
}

/** A lesson's or step's number, from its id. */
export function planNodeNumber(id: string): number {
  return Number.parseInt(id.replace(/^\D+/, ""), 10) || 0;
}

/* ── Ticks and links ── */

/** What a tick does to the statuses, before the server answers. Unticking
 *  keeps a problem solved when there's evidence for it, as the server does. */
export function applyTick(statuses: PlanStatuses, slug: string, done: boolean): PlanStatuses {
  const entry = statuses[slug];
  if (done) return { ...statuses, [slug]: { ...(entry ?? { status: "solved" as const }), ticked: true } };
  if (!entry) return statuses;
  const next = { ...statuses };
  if (entry.auto) {
    const kept = { ...entry };
    delete kept.ticked;
    next[slug] = kept;
  } else {
    delete next[slug];
  }
  return next;
}

export function planProblemUrl(problem: Pick<PlanCatalogProblem, "slug" | "cnOnly">, site: PlanSite): string {
  return leetcodeProblemUrl(problem.slug, problem.cnOnly ? "cn" : site);
}

export function ratingTone(rating: number): "text-easy" | "text-medium" | "text-hard" {
  return rating < 1400 ? "text-easy" : rating < 1900 ? "text-medium" : "text-hard";
}

/** Where the list view jumps to a section. Ids hold dots and colons, so use
 *  `getElementById`, not a selector. */
export function planNodeDomId(id: string): string {
  return `plan-node-${id}`;
}
