/**
 * Snapshot 灵茶山艾府 (EndlessCheng)'s twelve LeetCode problem lists into
 * packages/core, used with his permission. Each list is a markdown post on
 * leetcode.cn: headings name the patterns, and the problems under a heading
 * are that pattern's ladder, ordered by contest rating. Re-run when he edits
 * a list:
 *   pnpm patterns:sync
 *
 * Only the structure is kept: pattern names, problem slugs, ratings, and
 * whether a problem is core, advanced (选做/进阶), or an extension (思维扩展).
 * His explanations are not copied. English names and stable keys live in
 * scripts/pattern-names.json; a heading that has none fails the sync, so a
 * renamed or new section gets a name before it ships. `--outline` prints the
 * entries to add.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const NAMES = resolve(ROOT, "pattern-names.json");
const OUT = resolve(ROOT, "../packages/core/src/patterns.generated.ts");
const OUTLINE = process.argv.includes("--outline");

const DIFFICULTY = { Easy: "Easy", Medium: "Medium", Hard: "Hard" };
/** Sections with no problems to learn from: intros, Q&A, links to other lists. */
const SKIP = /^(前言|思考|思考题|答疑|关联题单|算法题单|编程能力强化训练|⚠)/;
/** Sub-headings that split one pattern into tiers instead of naming a new one.
 *  A Q&A sub-heading sits between a section's intro and its problems. */
const TIER = /^(基础|进阶|答疑)(（选做）)?$/;
const OPTIONAL = /（选做）/;
const PROBLEM =
  /^-\s*\[(\d+)\.\s*[^\]]*\]\(https:\/\/leetcode\.cn\/problems\/([a-z0-9-]+)\/?[^)]*\)\s*(.*)$/;

async function leetcodeCn(uuid) {
  const res = await fetch("https://leetcode.cn/graphql/", {
    method: "POST",
    headers: { "content-type": "application/json", referer: "https://leetcode.cn/" },
    body: JSON.stringify({
      query: "query list($uuid: ID!) { qaQuestion(uuid: $uuid) { content } }",
      variables: { uuid },
    }),
  });
  if (!res.ok) throw new Error(`${uuid}: HTTP ${res.status}`);
  const json = await res.json();
  const content = json.data?.qaQuestion?.content;
  if (!content) throw new Error(`${uuid}: ${JSON.stringify(json.errors ?? json)}`);
  return content;
}

/** leetcode.com's catalog by frontend id: the slug, English title, difficulty,
 *  and premium flag there (leetcode.cn's can differ). */
async function leetcodeCom() {
  const PAGE = 100; // the most leetcode.com returns per request
  const rows = [];
  for (let skip = 0; ; skip += PAGE) {
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", referer: "https://leetcode.com/" },
      body: JSON.stringify({
        query: `query page($skip: Int!, $limit: Int!) {
          questionList(categorySlug: "", limit: $limit, skip: $skip, filters: {}) {
            total: totalNum
            data { questionFrontendId titleSlug title difficulty isPaidOnly }
          }
        }`,
        variables: { skip, limit: PAGE },
      }),
    });
    if (!res.ok) throw new Error(`leetcode.com: HTTP ${res.status}`);
    const json = await res.json();
    const list = json.data?.questionList;
    if (!list) throw new Error(`leetcode.com: ${JSON.stringify(json.errors ?? json)}`);
    rows.push(...list.data);
    if (list.data.length === 0 || rows.length >= list.total) break;
  }
  return new Map(rows.map((q) => [Number(q.questionFrontendId), q]));
}

function cleanHeading(text) {
  return text
    .replace(/^[零一二三四五六七八九十]+、\s*/, "")
    .replace(/^§[\d.]+\s*/, "")
    .trim();
}

/**
 * Parse one list into heading paths with their problems. A path is the
 * cleaned heading texts joined by " / ", with tier headings folded into
 * their parent.
 */
function parseList(markdown) {
  const sections = new Map();
  const stack = []; // { level, text, skip, optional }
  let current = null;
  let tier = "core";

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{2,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = cleanHeading(heading[2]);
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      const parent = stack.at(-1);
      const isTier = level >= 3 && TIER.test(text) && Boolean(parent);
      const skip = Boolean(parent?.skip) || (!isTier && SKIP.test(text));
      const optional = Boolean(parent?.optional) || OPTIONAL.test(text);
      stack.push({ level, text, skip, optional, isTier });
      current = skip
        ? null
        : stack
            .filter((node) => !node.isTier)
            .map((node) => node.text.replace(OPTIONAL, "").trim())
            .join(" / ");
      tier = optional || (isTier && /^进阶/.test(text)) ? "advanced" : "core";
      continue;
    }
    if (!current) continue;
    if (/^\*\*(思维扩展|思考题)/.test(line)) tier = "extension";
    else if (/^\*\*进阶/.test(line)) tier = "advanced";
    const problem = PROBLEM.exec(line);
    if (!problem) continue;
    const [, id, cnSlug, rest] = problem;
    const rating = /^(?:约\s*)?(\d{3,4})(?!\d)/.exec(rest.replace(/^（会员题）/, "").trim());
    if (!sections.has(current)) sections.set(current, []);
    sections.get(current).push({
      id: Number(id),
      cnSlug,
      rating: rating ? Number(rating[1]) : null,
      tier,
    });
  }
  return sections;
}

const names = JSON.parse(await readFile(NAMES, "utf8"));
const catalog = await leetcodeCom();
const missing = [];
const topics = [];
const problems = new Map();
let dropped = 0;

for (const topic of names.topics) {
  const sections = parseList(await leetcodeCn(topic.source));
  const patterns = [];
  for (const [path, entries] of sections) {
    const name = topic.patterns[path];
    if (!name) {
      missing.push({ topic: topic.key, path, count: entries.length });
      continue;
    }
    const seen = new Set();
    const ladder = [];
    for (const entry of entries) {
      const q = catalog.get(entry.id);
      // leetcode.cn-only problems (LCP, LCR, 面试题) never match a numeric id.
      if (!q) {
        dropped++;
        continue;
      }
      if (seen.has(q.titleSlug)) continue;
      seen.add(q.titleSlug);
      const difficulty = DIFFICULTY[q.difficulty];
      if (!difficulty) throw new Error(`${q.titleSlug}: unknown difficulty ${q.difficulty}`);
      problems.set(q.titleSlug, {
        id: entry.id,
        title: q.title,
        difficulty,
        premium: q.isPaidOnly,
      });
      ladder.push([q.titleSlug, entry.rating, entry.tier]);
    }
    if (ladder.length === 0) continue;
    patterns.push({ key: `${topic.key}/${name.key}`, zh: path, en: name.en, problems: ladder });
  }
  const keys = new Set();
  for (const pattern of patterns) {
    if (keys.has(pattern.key)) throw new Error(`duplicate pattern key ${pattern.key}`);
    keys.add(pattern.key);
  }
  const count = patterns.reduce((sum, pattern) => sum + pattern.problems.length, 0);
  console.log(`✓ ${topic.en}: ${count} problems in ${patterns.length} patterns`);
  topics.push({ key: topic.key, source: topic.source, zh: topic.zh, en: topic.en, patterns });
}

if (missing.length) {
  if (OUTLINE) {
    for (const entry of missing) {
      console.log(`${entry.topic}\t${JSON.stringify(entry.path)}: { "key": "", "en": "" },\t// ${entry.count}`);
    }
  } else {
    for (const entry of missing) console.error(`✗ ${entry.topic}: no name for "${entry.path}" (${entry.count} problems)`);
    console.error("Add them to scripts/pattern-names.json (`pnpm patterns:sync --outline` prints them).");
  }
  process.exit(1);
}
console.log(`${problems.size} distinct problems; dropped ${dropped} leetcode.cn-only entries`);

const body = topics
  .map(
    (topic) => `  {
    key: ${JSON.stringify(topic.key)},
    source: ${JSON.stringify(topic.source)},
    zh: ${JSON.stringify(topic.zh)},
    en: ${JSON.stringify(topic.en)},
    patterns: [
${topic.patterns
  .map(
    (pattern) => `      {
        key: ${JSON.stringify(pattern.key)},
        zh: ${JSON.stringify(pattern.zh)},
        en: ${JSON.stringify(pattern.en)},
        problems: [
${pattern.problems.map((p) => `          ${JSON.stringify(p)},`).join("\n")}
        ],
      },`,
  )
  .join("\n")}
    ],
  },`,
  )
  .join("\n");

const problemBody = [...problems]
  .sort((a, b) => a[1].id - b[1].id)
  .map(([slug, p]) => `  ${JSON.stringify(slug)}: ${JSON.stringify(p)},`)
  .join("\n");

await writeFile(
  OUT,
  `// Generated by scripts/sync-pattern-lists.mjs from 灵茶山艾府's problem lists
// on leetcode.cn (used with permission). Do not edit by hand; run
// \`pnpm patterns:sync\` instead.
import type { PatternProblem, PatternTopic } from "./patterns";

export const PATTERN_TOPIC_DATA: readonly PatternTopic[] = [
${body}
];

export const PATTERN_PROBLEM_DATA: Readonly<Record<string, PatternProblem>> = {
${problemBody}
};
`,
);
console.log(`wrote ${OUT}`);
