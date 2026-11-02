/**
 * Snapshot the study-plan map into packages/core. The source is the saved map
 * page (its `lc-data` JSON): 灵茶山艾府's twelve lists (used with his
 * permission), his 27-video course and seven-step core route, and the NeetCode,
 * Hot 100, and Top Interview 150 lists. Re-run when the map changes:
 *   pnpm plans:catalog <path-to-saved-page.html>
 *
 * Only structure is kept: titles, problem data, ratings, urls, each post's last
 * update. Fields are
 * copied one by one, so the page's prose (`d`, `n`, ...), NeetCode's video ids,
 * and the Blind 75 flag never reach the output. English names are our own, in
 * scripts/plan-catalog-names.json keyed by node id; a node without one fails
 * the sync, so a new section gets a name before it ships.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const NAMES = resolve(ROOT, "plan-catalog-names.json");
const PATTERN_NAMES = resolve(ROOT, "pattern-names.json");
const OUT = resolve(ROOT, "../packages/core/src/plan-catalog.generated.ts");

const pagePath = process.argv[2];
if (!pagePath) {
  console.error("Usage: pnpm plans:catalog <path-to-saved-page.html>");
  process.exit(1);
}

const page = await readFile(resolve(pagePath), "utf8");
const dataMatch = /<script type="application\/json" id="lc-data">([\s\S]*?)<\/script>/.exec(page);
if (!dataMatch) throw new Error(`${pagePath}: no lc-data script`);
const data = JSON.parse(dataMatch[1]);

const names = JSON.parse(await readFile(NAMES, "utf8"));
const topics = JSON.parse(await readFile(PATTERN_NAMES, "utf8")).topics;
const missing = [];
const used = new Set();

/** The English name of a node. Numbering must match the Chinese title. */
function en(id, zh) {
  const name = names[id];
  used.add(id);
  if (!name) {
    missing.push(`${id}: ${zh}`);
    return "";
  }
  const section = /^§([\d.]+)/.exec(zh)?.[1];
  if (section && !name.startsWith(`§${section} `)) throw new Error(`${id}: "${name}" should start with §${section}`);
  return name;
}

const CN_NUMERAL = /^([零一二三四五六七八九十]+)、/;
const CN_VALUES = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function chapterNumber(zh) {
  const numeral = CN_NUMERAL.exec(zh)?.[1];
  if (!numeral) return null;
  if (numeral === "十") return 10;
  if (numeral.startsWith("十")) return 10 + CN_VALUES[numeral[1]];
  if (numeral.endsWith("十")) return CN_VALUES[numeral[0]] * 10;
  if (numeral.includes("十")) return CN_VALUES[numeral[0]] * 10 + CN_VALUES[numeral[2]];
  return CN_VALUES[numeral];
}

/* ── Problems ── */

const TAG_BITS = 1 | 2 | 4 | 8; // NC150, NC250, Hot 100, Top Interview 150; never Blind 75 (16).
const flags = data.ext.flags;

/** A problem reference: its frontend id, or its slug for leetcode.cn-only ones. */
function ref(key) {
  const problem = data.P[key];
  if (!problem) throw new Error(`unknown problem key ${key}`);
  return problem[6] ? problem[2] : Number(key);
}

const problems = Object.entries(data.P).map(([key, p]) => {
  const [zh, enTitle, slug, rating, difficulty, premium, cnOnly, label] = p;
  if (cnOnly ? !key.startsWith("#") || !label : !/^\d+$/.test(key)) throw new Error(`bad problem key ${key}`);
  const row = [slug, cnOnly ? 0 : Number(key), zh, enTitle, rating, difficulty, premium, cnOnly, (flags[key] ?? 0) & TAG_BITS];
  if (cnOnly) row.push(label);
  return row;
});
const slugs = new Set(problems.map((row) => row[0]));
if (slugs.size !== problems.length) throw new Error("duplicate problem slugs");

/* ── The dictionary ── */

const topicBySource = new Map(topics.map((topic) => [topic.source, topic.key]));

function section(node) {
  const zh = node.t;
  const row = { id: node.id, zh, en: en(node.id, zh) };
  const chapter = chapterNumber(zh);
  if (chapter != null && !row.en.startsWith(`${chapter}. `)) {
    throw new Error(`${node.id}: "${row.en}" should start with "${chapter}. "`);
  }
  if (node.o) row.o = 1;
  if (node.core) {
    if (!node.cap) throw new Error(`${node.id}: core without a cap`);
    row.cap = node.cap;
  }
  if (node.ref) row.ref = node.ref;
  if (node.p?.length) row.p = node.p.map(ref);
  if (node.c?.length) row.c = node.c.map(section);
  return row;
}

const topicOf = new Map();
const lists = data.lists.map((list) => {
  const source = /\/discuss\/([^/]+)\/?$/.exec(list.url)?.[1];
  const topic = topicBySource.get(source);
  if (!topic) throw new Error(`${list.id}: no topic in pattern-names.json for ${list.url}`);
  topicOf.set(list.k, topic);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(list.upd ?? "")) throw new Error(`${list.id}: no source post date`);
  return { ...section(list), topic, url: list.url, updated: list.upd };
});

function ids(rows, out = new Set()) {
  for (const row of rows) {
    out.add(row.id);
    if (row.c) ids(row.c, out);
  }
  return out;
}
const sectionIds = ids(lists);

/* ── The course, the route, and the high-frequency lists ── */

const videos = data.videos.map((video, index) => {
  for (const link of video.links) {
    if (!sectionIds.has(link)) throw new Error(`V${index}: unknown link ${link}`);
  }
  return { zh: video.t, en: en(`V${index}`, video.t), url: video.url, p: video.p.map(ref), hw: video.hw.map(ref), links: video.links };
});

const steps = data.core.map((step, index) => {
  for (const id of step.secs) {
    if (!sectionIds.has(id)) throw new Error(`step ${index + 1}: unknown section ${id}`);
  }
  const topic = topicOf.get(step.list);
  if (!topic) throw new Error(`step ${index + 1}: unknown list ${step.list}`);
  return { zh: step.t, en: en(`X${index + 1}`, step.t), topic, cap: step.cap, secs: step.secs };
});

const frequent = data.hf.map((list) => ({
  id: list.id,
  zh: list.t,
  url: list.url,
  g: list.g.map((group, index) => ({
    zh: group.t,
    // NeetCode's categories are his own English names.
    en: group.en ?? en(`${list.id}${index}`, group.t),
    p: group.p.map(ref),
  })),
}));

const stale = Object.keys(names).filter((id) => !used.has(id));
if (missing.length || stale.length) {
  for (const entry of missing) console.error(`✗ no English name for ${entry}`);
  for (const id of stale) console.error(`✗ ${id} in plan-catalog-names.json matches no node`);
  console.error("Update scripts/plan-catalog-names.json.");
  process.exit(1);
}

/* ── Output ── */

const json = JSON.stringify;

function sectionSource(row, indent) {
  const pad = " ".repeat(indent);
  const { c, ...own } = row;
  if (!c) return `${pad}${json(own)},`;
  const head = json(own).slice(0, -1);
  return `${pad}${head},"c":[\n${c.map((child) => sectionSource(child, indent + 2)).join("\n")}\n${pad}]},`;
}

await writeFile(
  OUT,
  `// Generated by scripts/sync-plan-catalog.mjs from the study-plan map page
// (built ${data.built}): 灵茶山艾府's lists, course, and core route (used with
// permission), plus the NeetCode, Hot 100, and Top Interview 150 lists. Do not
// edit by hand; run \`pnpm plans:catalog <path-to-saved-page>\` instead. English
// names come from scripts/plan-catalog-names.json.
import type {
  PlanFrequentRow,
  PlanProblemRow,
  PlanSectionRow,
  PlanStepRow,
  PlanVideoRow,
} from "./plan-catalog";

export const PLAN_COURSE_URL = ${json(data.readme)};

/** [slug, id, zh, en, rating, difficulty, premium, cnOnly, tag bits, label?] */
export const PLAN_PROBLEM_ROWS: readonly PlanProblemRow[] = [
${problems.map((row) => `  ${json(row)},`).join("\n")}
];

/** Problem references are frontend ids, or slugs for leetcode.cn-only problems. */
export const PLAN_LIST_ROWS: readonly PlanSectionRow[] = [
${lists.map((list) => sectionSource(list, 2)).join("\n")}
];

export const PLAN_VIDEO_ROWS: readonly PlanVideoRow[] = [
${videos.map((video) => `  ${json(video)},`).join("\n")}
];

export const PLAN_STEP_ROWS: readonly PlanStepRow[] = [
${steps.map((step) => `  ${json(step)},`).join("\n")}
];

export const PLAN_FREQUENT_ROWS: readonly PlanFrequentRow[] = [
${frequent.map((list) => `  ${json(list)},`).join("\n")}
];
`,
);
console.log(`${problems.length} problems, ${sectionIds.size} sections, ${videos.length} videos, ${steps.length} steps`);
console.log(`wrote ${OUT}`);
