import type { PlanCatalogNode, PlanCatalogNodeKind } from "@ankify/core/plan-catalog";
import {
  hasSearchableTitle,
  matchesPlanProblem,
  normalizePlanQuery,
  pathToRoot,
  planOnlyNode,
  type PlanIndex,
  type PlanNodeState,
  type PlanOnly,
  type PlanStatuses,
} from "./plan-map-model";

/**
 * The mind map as pure functions: what's open, where every node goes, which
 * nodes a window can see, and search. Drawn left to right; a parent sits
 * centered on its children.
 */

/* ── What's open ── */

export const PLAN_MAP_LEVELS = ["lists", "steps", "all"] as const;
export type PlanMapLevel = (typeof PLAN_MAP_LEVELS)[number];

export function parsePlanMapLevel(value: unknown): PlanMapLevel | null {
  return PLAN_MAP_LEVELS.includes(value as PlanMapLevel) ? (value as PlanMapLevel) : null;
}

const DICTIONARY = "G";
/** Levels open everything above this depth: root 0, groups 1, lists 2. */
const LEVEL_DEPTH: Record<PlanMapLevel, number> = { lists: 2, steps: 3, all: Number.POSITIVE_INFINITY };

const ownProblems = (node: PlanCatalogNode) => node.problems.length + (node.homework?.length ?? 0);

/**
 * What a level opens. The dictionary is for looking things up and has
 * thousands of rows, so it stays closed until asked for: by opening it, or by
 * scoping to it, when its lists count as the lists. A scope always opens the
 * way down to its list and the list itself.
 */
export function levelExpansion(index: PlanIndex, level: PlanMapLevel, only: PlanOnly): Set<string> {
  const open = new Set<string>();
  const limit = LEVEL_DEPTH[level];
  const walk = (node: PlanCatalogNode, depth: number) => {
    const isDictionary = node.id === DICTIONARY;
    if (isDictionary && only !== "dictionary") return;
    if (depth < limit && node.children.length + ownProblems(node) > 0) open.add(node.id);
    for (const child of node.children) walk(child, isDictionary ? depth : depth + 1);
  };
  walk(index.catalog.tree, 0);
  const target = planOnlyNode(only);
  if (target) for (const id of pathToRoot(index, target)) open.add(id);
  return open;
}

/* ── Where things go ── */

export type PlanMapNodeKind = PlanCatalogNodeKind | "problem";

const WIDTH: Record<PlanMapNodeKind, number> = {
  root: 208,
  group: 288,
  block: 280,
  dictionary: 280,
  list: 280,
  step: 288,
  video: 288,
  section: 288,
  problem: 448,
};
const COLUMN_GAP = 44;
const PADDING = 18;

/** A section's second row: what the list view shows as chips. */
export function hasSectionChips(index: PlanIndex, node: PlanCatalogNode): boolean {
  if (node.via || node.ref || (node.videos?.length ?? 0) > 0) return true;
  if (node.optional && !index.nodes.get(index.parents.get(node.id) ?? "")?.optional) return true;
  const sourceSize = node.source ? (index.subtree.get(node.source)?.length ?? 0) : 0;
  return node.children.length === 0 && sourceSize > node.problems.length;
}

function nodeHeight(index: PlanIndex, kind: PlanMapNodeKind, node: PlanCatalogNode): number {
  switch (kind) {
    case "problem":
      return 28;
    case "root":
    case "group":
      return 46;
    case "block":
    case "dictionary":
    case "list":
      return 58;
    case "video":
    case "step":
      return 50;
    case "section":
      return hasSectionChips(index, node) ? 50 : 34;
  }
}

function gapAfter(kind: PlanMapNodeKind): number {
  if (kind === "problem") return 5;
  return kind === "section" || kind === "video" || kind === "step" ? 9 : 14;
}

export interface PlanMapNode {
  /** The catalog id, or `parent|slug` for a problem: a problem can be in many lists. */
  id: string;
  kind: PlanMapNodeKind;
  /** The catalog node. On a problem, the node it's listed under. */
  node: PlanCatalogNode;
  slug?: string;
  /** A problem under a lesson: homework, or worked in the video. */
  lessonRole?: "worked" | "homework";
  /** The node it hangs under, as a position in `nodes`; -1 for the root. */
  parent: number;
  /** The list or block it belongs to, which decides the tags it leaves out. */
  blockId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Past the last node in its subtree: `nodes` is in tree order. */
  end: number;
  /** How far its subtree reaches, so a window can skip all of it at once. */
  top: number;
  bottom: number;
  right: number;
  expandable: boolean;
  expanded: boolean;
}

export interface PlanMapLayout {
  nodes: readonly PlanMapNode[];
  positions: ReadonlyMap<string, number>;
  width: number;
  height: number;
}

/** A lesson's or section's rows come from `states`, so a scope or language
 *  narrows them the same way it narrows the list view. */
export function layoutPlanMap(input: {
  index: PlanIndex;
  states: ReadonlyMap<string, PlanNodeState>;
  expanded: ReadonlySet<string>;
  only: PlanOnly;
}): PlanMapLayout {
  const { index, states, expanded, only } = input;
  const target = planOnlyNode(only);
  const scopePath = target ? new Set(pathToRoot(index, target)) : null;
  const nodes: PlanMapNode[] = [];
  let cursor = PADDING;
  let width = 0;

  const place = (entry: PlanMapNode): void => {
    const position = nodes.length;
    nodes.push(entry);
    width = Math.max(width, entry.x + entry.w);
    const gap = gapAfter(entry.kind);
    const childX = entry.x + entry.w + COLUMN_GAP;
    const kids: PlanMapNode[] = [];

    if (entry.kind !== "problem" && entry.expanded) {
      const { node } = entry;
      // Above a scoped list, keep only the way down to it.
      const above = scopePath && (node.kind === "root" || node.kind === "group");
      for (const child of node.children) {
        if (above && !scopePath.has(child.id)) continue;
        kids.push(catalogEntry(child, childX, position, entry.blockId));
      }
      const state = states.get(node.id);
      const lesson = node.kind === "video";
      for (const slug of state?.rows ?? []) {
        kids.push(problemEntry(node, slug, childX, position, entry.blockId, lesson ? "worked" : undefined));
      }
      for (const slug of state?.homework ?? []) {
        kids.push(problemEntry(node, slug, childX, position, entry.blockId, lesson ? "homework" : undefined));
      }
    }

    if (kids.length === 0) {
      entry.y = cursor;
      cursor += entry.h + gap;
      entry.end = nodes.length;
      return;
    }

    const start = cursor;
    const first = nodes.length;
    for (const kid of kids) place(kid);
    const a = kids[0]!;
    const b = kids[kids.length - 1]!;
    let y = (a.y + a.h / 2 + (b.y + b.h / 2)) / 2 - entry.h / 2;
    if (y < start) {
      const shift = start - y;
      for (let i = first; i < nodes.length; i += 1) nodes[i]!.y += shift;
      cursor += shift;
      y = start;
    }
    entry.y = y;
    entry.end = nodes.length;
    cursor = Math.max(cursor, y + entry.h + gap) + 6;
  };

  const catalogEntry = (node: PlanCatalogNode, x: number, parent: number, blockId: string | null): PlanMapNode => {
    const expandable = node.children.length > 0 || (states.get(node.id)?.all.size ?? 0) > 0;
    return {
      id: node.id,
      kind: node.kind,
      node,
      parent,
      blockId: node.kind === "block" || node.kind === "list" ? node.id : blockId,
      x,
      y: 0,
      w: WIDTH[node.kind],
      h: nodeHeight(index, node.kind, node),
      end: 0,
      top: Number.POSITIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      expandable,
      expanded: expandable && expanded.has(node.id),
    };
  };

  const problemEntry = (
    node: PlanCatalogNode,
    slug: string,
    x: number,
    parent: number,
    blockId: string | null,
    lessonRole: PlanMapNode["lessonRole"],
  ): PlanMapNode => ({
    id: `${node.id}|${slug}`,
    kind: "problem",
    node,
    slug,
    ...(lessonRole ? { lessonRole } : {}),
    parent,
    blockId,
    x,
    y: 0,
    w: WIDTH.problem,
    h: nodeHeight(index, "problem", node),
    end: 0,
    top: Number.POSITIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    expandable: false,
    expanded: false,
  });

  place(catalogEntry(index.catalog.tree, PADDING, -1, null));

  const positions = new Map<string, number>();
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const entry = nodes[i]!;
    positions.set(entry.id, i);
    entry.top = Math.min(entry.top, entry.y);
    entry.bottom = Math.max(entry.bottom, entry.y + entry.h);
    entry.right = Math.max(entry.right, entry.x + entry.w);
    if (entry.parent >= 0) {
      const parent = nodes[entry.parent]!;
      parent.top = Math.min(parent.top, entry.top);
      parent.bottom = Math.max(parent.bottom, entry.bottom);
      parent.right = Math.max(parent.right, entry.right);
    }
  }
  return { nodes, positions, width: width + 24, height: cursor + PADDING };
}

/* ── What a window can see ── */

export interface PlanMapWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

const edgePath = (parent: PlanMapNode, child: PlanMapNode) => {
  const x1 = parent.x + parent.w;
  const y1 = parent.y + parent.h / 2;
  const x2 = child.x;
  const y2 = child.y + child.h / 2;
  const mid = (x1 + x2) / 2;
  return `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
};

/**
 * The nodes and connectors inside a window. Whole subtrees outside it are
 * skipped, so the cost follows what's on screen, not the size of the map. A
 * connector can cross the window with both ends outside, so each is tested
 * apart from its node.
 */
export function planMapInWindow(layout: PlanMapLayout, win: PlanMapWindow): { nodes: PlanMapNode[]; edges: string } {
  const { nodes } = layout;
  const left = win.x;
  const right = win.x + win.w;
  const top = win.y;
  const bottom = win.y + win.h;
  const visible: PlanMapNode[] = [];
  const edges: string[] = [];
  let i = 0;
  while (i < nodes.length) {
    const entry = nodes[i]!;
    if (entry.parent >= 0) {
      const parent = nodes[entry.parent]!;
      const y1 = parent.y + parent.h / 2;
      const y2 = entry.y + entry.h / 2;
      if (parent.x + parent.w <= right && entry.x >= left && Math.max(y1, y2) >= top && Math.min(y1, y2) <= bottom) {
        edges.push(edgePath(parent, entry));
      }
    }
    if (entry.bottom < top || entry.top > bottom || entry.right < left || entry.x > right) {
      i = entry.end;
      continue;
    }
    if (entry.y + entry.h >= top && entry.y <= bottom && entry.x + entry.w >= left && entry.x <= right) {
      visible.push(entry);
    }
    i += 1;
  }
  return { nodes: visible, edges: edges.join("") };
}

/* ── Counts ── */

export type PlanMapCount = { solved: number; total: number };

function unionCount(ids: readonly string[], states: ReadonlyMap<string, PlanNodeState>, statuses: PlanStatuses): PlanMapCount {
  const seen = new Set<string>();
  for (const id of ids) for (const slug of states.get(id)?.all ?? []) seen.add(slug);
  let solved = 0;
  for (const slug of seen) if (statuses[slug]) solved += 1;
  return { solved, total: seen.size };
}

/**
 * Solved of total for every node. The dictionary isn't part of what a user
 * works through, so the root and his group leave it out, which makes the root
 * the same number as the Total meter. Under a scope, what's above the list
 * counts that list.
 */
export function planMapCounts(
  index: PlanIndex,
  states: ReadonlyMap<string, PlanNodeState>,
  statuses: PlanStatuses,
  only: PlanOnly,
): Map<string, PlanMapCount> {
  const counts = new Map<string, PlanMapCount>();
  for (const [id, state] of states) counts.set(id, { solved: state.solved, total: state.all.size });
  const target = planOnlyNode(only);
  if (target) {
    const count = counts.get(target);
    if (count) for (const id of pathToRoot(index, target)) counts.set(id, count);
  } else {
    counts.set("root", unionCount(["C", "X", "N", "H", "T"], states, statuses));
    counts.set("gL", unionCount(["C", "X"], states, statuses));
  }
  return counts;
}

/* ── Search ── */

export type PlanMapSearch = {
  hits: ReadonlySet<string>;
  /** What to open so the hits show. */
  open: ReadonlySet<string>;
  first: string | null;
  total: number;
};

/**
 * Finds problems by number or title, and sections by title, the lists you work
 * through first and the dictionary last. Only the first `cap` hits are opened
 * and marked: one word can match thousands of rows.
 */
export function searchPlanMap(input: {
  index: PlanIndex;
  states: ReadonlyMap<string, PlanNodeState>;
  query: string;
  cap: number;
}): PlanMapSearch {
  const { index, states, cap } = input;
  const query = normalizePlanQuery(input.query);
  const hits = new Set<string>();
  const open = new Set<string>();
  let first: string | null = null;
  let total = 0;
  if (!query) return { hits, open, first, total };
  const { problems } = index.catalog;
  const numeric = /^\d+$/.test(query);

  const hit = (id: string, opens: string) => {
    total += 1;
    if (hits.size >= cap) return;
    hits.add(id);
    first ??= id;
    for (const ancestor of pathToRoot(index, opens)) open.add(ancestor);
  };
  const check = (node: PlanCatalogNode) => {
    if (
      !numeric &&
      hasSearchableTitle(node) &&
      (normalizePlanQuery(node.title.en).includes(query) || normalizePlanQuery(node.title.zh).includes(query))
    ) {
      const parent = index.parents.get(node.id);
      if (parent) hit(node.id, parent);
    }
    const state = states.get(node.id);
    for (const slug of [...(state?.rows ?? []), ...(state?.homework ?? [])]) {
      const problem = problems[slug];
      if (problem && matchesPlanProblem(problem, query)) hit(`${node.id}|${slug}`, node.id);
    }
  };
  const walk = (node: PlanCatalogNode) => {
    check(node);
    node.children.forEach(walk);
  };
  const node = (id: string) => index.nodes.get(id);
  for (const id of ["X", "C"]) {
    const block = node(id);
    if (block) walk(block);
  }
  node("gH")?.children.forEach(walk);
  node(DICTIONARY)?.children.forEach(walk);
  return { hits, open, first, total };
}

/* ── Moving around ── */

export type PlanMapView = { z: number; tx: number; ty: number };
export type PlanMapSize = { w: number; h: number };

export const PLAN_MAP_ZOOM_MIN = 0.2;
export const PLAN_MAP_ZOOM_MAX = 2.5;
/** At least this much of the map stays on screen, so it can't be lost. */
const KEEP_ON_SCREEN = 80;

export const clampPlanMapZoom = (z: number) => Math.min(PLAN_MAP_ZOOM_MAX, Math.max(PLAN_MAP_ZOOM_MIN, z));

export function clampPlanMapView(view: PlanMapView, size: PlanMapSize, layout: Pick<PlanMapLayout, "width" | "height">): PlanMapView {
  return {
    z: view.z,
    tx: Math.min(size.w - KEEP_ON_SCREEN, Math.max(KEEP_ON_SCREEN - layout.width * view.z, view.tx)),
    ty: Math.min(size.h - KEEP_ON_SCREEN, Math.max(KEEP_ON_SCREEN - layout.height * view.z, view.ty)),
  };
}

/** Zoom keeping the point under (`cx`, `cy`) where it is. */
export function zoomPlanMapAt(view: PlanMapView, z: number, cx: number, cy: number): PlanMapView {
  const next = clampPlanMapZoom(z);
  const worldX = (cx - view.tx) / view.z;
  const worldY = (cy - view.ty) / view.z;
  return { z: next, tx: cx - worldX * next, ty: cy - worldY * next };
}

/** Everything in view if it fits; a tall map stops at the smallest zoom,
 *  still centered. */
export function fitPlanMapView(size: PlanMapSize, layout: Pick<PlanMapLayout, "width" | "height">): PlanMapView {
  const z = clampPlanMapZoom(Math.min((size.w - 40) / layout.width, (size.h - 40) / layout.height, 1.2));
  return { z, tx: (size.w - layout.width * z) / 2, ty: (size.h - layout.height * z) / 2 };
}

/** The root at the left edge, halfway down. */
export function rootPlanMapView(z: number, size: PlanMapSize, root: PlanMapNode): PlanMapView {
  return { z, tx: 24 - root.x * z, ty: size.h / 2 - (root.y + root.h / 2) * z };
}

/** A node a bit left of the middle, with room for what's right of it. */
export function centerPlanMapView(z: number, size: PlanMapSize, node: PlanMapNode): PlanMapView {
  return { z, tx: size.w * 0.35 - (node.x + node.w / 2) * z, ty: size.h / 2 - (node.y + node.h / 2) * z };
}

/** The part of the map a view shows. */
export function planMapSeen(view: PlanMapView, size: PlanMapSize): PlanMapWindow {
  return { x: -view.tx / view.z, y: -view.ty / view.z, w: size.w / view.z, h: size.h / view.z };
}
