/*
 * Suggestion catalog generator (read-only).
 *
 * Builds the committed cold-start catalog at
 * apps/web/src/server/suggestions/catalog.json from LeetCode's own problem
 * list, so every entry's title, difficulty, topics, and free availability are
 * as LeetCode reports them at generation time. Nothing in the catalog is
 * written by hand or by a model.
 *
 * Rule: for each topic below and each of Easy and Medium, the first
 * PER_TOPIC free problems in LeetCode's default list order, each problem once.
 *
 * Usage: open any https://leetcode.com/problems/<slug>/ page (signed in or
 * not), paste this whole file into the DevTools console, and press Enter. The
 * catalog JSON is printed and copied to the clipboard; save it as catalog.json
 * and run `pnpm vitest run apps/web/src/server/suggestions/catalog.test.ts`.
 * Only queries are sent, and no per-user field (such as solved status) is
 * requested, so the output is the same for every account.
 */
(async () => {
  if (location.origin !== "https://leetcode.com") {
    console.error("Open a https://leetcode.com/ page first.");
    return;
  }
  const TOPICS = [
    "array", "string", "hash-table", "two-pointers", "sliding-window", "stack", "binary-search",
    "linked-list", "tree", "depth-first-search", "breadth-first-search", "graph", "heap-priority-queue",
    "backtracking", "dynamic-programming", "greedy", "sorting", "prefix-sum", "bit-manipulation", "matrix",
  ];
  const DIFFICULTIES = ["EASY", "MEDIUM"];
  const PER_TOPIC = 6;
  const PAGE = 50;
  const MAX_PAGES = 4;
  const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function page(topic, difficulty, skip) {
    const response = await fetch("/graphql/", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...(csrf ? { "x-csrftoken": decodeURIComponent(csrf) } : {}) },
      body: JSON.stringify({
        query: `query ankifyCatalog($skip: Int!, $limit: Int!, $filters: QuestionListFilterInput) {
          questionList(categorySlug: "", limit: $limit, skip: $skip, filters: $filters) {
            totalNum
            data { titleSlug title difficulty isPaidOnly topicTags { name } }
          }
        }`,
        variables: { skip, limit: PAGE, filters: { difficulty, tags: [topic] } },
      }),
    });
    const json = await response.json().catch(() => null);
    const list = json?.data?.questionList;
    if (!response.ok || !list || !Array.isArray(list.data)) {
      throw new Error(`${topic}/${difficulty} skip ${skip}: HTTP ${response.status} ${JSON.stringify(json?.errors ?? null).slice(0, 200)}`);
    }
    return list;
  }

  const entries = new Map();
  const report = [];
  for (const topic of TOPICS) {
    for (const difficulty of DIFFICULTIES) {
      let taken = 0;
      for (let pageIndex = 0; pageIndex < MAX_PAGES && taken < PER_TOPIC; pageIndex += 1) {
        const list = await page(topic, difficulty, pageIndex * PAGE);
        for (const question of list.data) {
          if (taken >= PER_TOPIC) break;
          // Only entries whose every field LeetCode reported are kept.
          if (question.isPaidOnly !== false || typeof question.titleSlug !== "string" || typeof question.title !== "string") continue;
          if (question.difficulty !== "Easy" && question.difficulty !== "Medium") continue;
          taken += 1;
          if (entries.has(question.titleSlug)) continue;
          entries.set(question.titleSlug, {
            slug: question.titleSlug,
            title: question.title.slice(0, 512),
            difficulty: question.difficulty,
            topicTags: (question.topicTags ?? []).map((tag) => String(tag.name).slice(0, 64)).slice(0, 64),
          });
        }
        if ((pageIndex + 1) * PAGE >= list.totalNum) break;
        await sleep(250);
      }
      report.push(`${topic}/${difficulty}: ${taken}`);
      await sleep(250);
    }
  }

  const catalog = {
    generatedAt: new Date().toISOString(),
    rule: `First ${PER_TOPIC} free Easy and Medium problems per topic in LeetCode's default order; topics: ${TOPICS.join(", ")}.`,
    entries: [...entries.values()],
  };
  console.log(report.join("\n"));
  const json = JSON.stringify(catalog, null, 2);
  console.log(json);
  try { copy(json); console.log(`Catalog with ${catalog.entries.length} problems copied to the clipboard.`); } catch { console.log("Copy the catalog above."); }
})();
