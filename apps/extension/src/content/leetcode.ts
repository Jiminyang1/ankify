import type { CaptureProblemInput, CaptureSubmissionInput } from "@ankify/contracts";
import { leetcodeProblemUrl, leetcodeSiteOfHost, type LeetcodeSite } from "@ankify/core/leetcode-site";
import type { SubmissionSummary } from "../shared/messages";
import { storedVerdict, submissionVerdict } from "./submission-status";

/**
 * LeetCode page extraction.
 *
 * Strategy: prefer their public GraphQL endpoint (same one the page uses) for
 * structured fields. Fall back to DOM scraping for the title if GraphQL fails.
 *
 * The submission list and per-submission details are also fetched via GraphQL.
 *
 * leetcode.cn has the same `/graphql/` and `question` query, but no
 * `questionSubmissionList`, `submissionDetails`, or `questionList`: see the
 * `*Cn` functions below. Its `question` also carries the Chinese title and
 * statement the page shows, and problems only on leetcode.cn have only those.
 */

const GRAPHQL = "/graphql/";

/** The LeetCode site this content script is running on. */
export const LEETCODE_PAGE_SITE: LeetcodeSite = leetcodeSiteOfHost(window.location.hostname) ?? "com";

type GqlResponse<T> = { data: T; errors?: { message: string }[] };

/** LeetCode auth-protected queries require the csrftoken cookie echoed back as
 *  an `x-csrftoken` header. The cookie is NOT HttpOnly so we can read it
 *  directly. Without it `submissionList` / `submissionDetails` silently return
 *  null even for a logged-in user. */
function csrfToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = csrfToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(GRAPHQL, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-csrftoken": token } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
  if (!res.ok) {
    // Surface the response body so we can see WHICH field/type is rejected.
    const body = await res.text().catch(() => "");
    throw new Error(`graphql ${res.status}: ${body.slice(0, 500)}`);
  }
  const j = (await res.json()) as GqlResponse<T>;
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join("; "));
  return j.data;
}

function slugFromUrl(): string | null {
  const m = window.location.pathname.match(/^\/problems\/([^/]+)/);
  return m?.[1] ?? null;
}

async function fetchProblem(slug: string) {
  type R = {
    question: {
      questionFrontendId: string;
      title: string;
      titleSlug: string;
      difficulty: "Easy" | "Medium" | "Hard";
      content: string;
      translatedTitle?: string | null;
      translatedContent?: string | null;
      topicTags: { slug: string; name: string }[];
      similarQuestions: string;
    } | null;
  };
  const data = await gql<R>(
    `query Q($slug: String!) {
       question(titleSlug: $slug) {
         questionFrontendId title titleSlug difficulty content
         ${LEETCODE_PAGE_SITE === "cn" ? "translatedTitle translatedContent" : ""}
         topicTags { slug name }
         similarQuestions
       }
     }`,
    { slug },
  );
  return data.question;
}

type RawSubmission = {
  id: string;
  statusDisplay: string;
  status?: string | number | null;
  isPending?: string | boolean | null;
  lang: string;
  runtime: string;
  memory: string;
  timestamp: string;
};

/** Two GraphQL ops cover the current and legacy LeetCode submission listing.
 *  Modern site (~2023+) uses `questionSubmissionList`; the old `submissionList`
 *  still resolves on some endpoints. We try modern first, fall back. */
async function fetchRecentSubmissions(slug: string, limit = 5): Promise<RawSubmission[]> {
  if (LEETCODE_PAGE_SITE === "cn") return fetchRecentSubmissionsCn(slug, limit);
  try {
    type R = {
      questionSubmissionList: {
        submissions: RawSubmission[];
      } | null;
    };
    const data = await gql<R>(
      `query Q($questionSlug: String!, $offset: Int!, $limit: Int!, $lastKey: String) {
         questionSubmissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit, lastKey: $lastKey) {
           submissions { id statusDisplay lang runtime memory timestamp }
         }
       }`,
      { questionSlug: slug, offset: 0, limit, lastKey: null },
    );
    const subs = data.questionSubmissionList?.submissions ?? [];
    if (subs.length > 0) return subs;
  } catch {
    /* fall through to legacy op */
  }

  try {
    type R = {
      submissionList: {
        submissions: RawSubmission[];
      } | null;
    };
    const data = await gql<R>(
      `query Q($questionSlug: String!, $offset: Int!, $limit: Int!) {
         submissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit) {
           submissions { id statusDisplay lang runtime memory timestamp }
         }
       }`,
      { questionSlug: slug, offset: 0, limit },
    );
    return data.submissionList?.submissions ?? [];
  } catch {
    return [];
  }
}

/** Errors reach the caller, so a failed read is never mistaken for "no
 *  submissions yet". */
async function fetchRecentSubmissionsCn(slug: string, limit: number): Promise<RawSubmission[]> {
  type R = { submissionList: { submissions: RawSubmission[] } | null };
  const data = await gql<R>(
    `query Q($questionSlug: String!, $offset: Int!, $limit: Int!, $lastKey: String) {
       submissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit, lastKey: $lastKey) {
         submissions { id status statusDisplay isPending lang runtime memory timestamp }
       }
     }`,
    { questionSlug: slug, offset: 0, limit, lastKey: null },
  );
  return data.submissionList?.submissions ?? [];
}

function toSummary(s: RawSubmission): SubmissionSummary {
  return { id: s.id, status: submissionVerdict(s), timestamp: Number(s.timestamp) || 0 };
}

/** The user's latest submissions for this slug, newest first. */
export async function fetchSubmissionSummaries(slug: string, limit = 20): Promise<SubmissionSummary[]> {
  return (await fetchRecentSubmissions(slug, limit)).map(toSummary);
}

type SubmissionDetails = {
  code: string;
  lang: { name: string; verboseName?: string };
  runtimeDisplay: string | null;
  memoryDisplay: string | null;
  lastTestcase: string | null;
  expectedOutput: string | null;
  codeOutput: string | null;
  runtimeError: string | null;
  compileError: string | null;
  timestamp: number;
};

/** leetcode.cn's `submissionDetail`, in the shape of leetcode.com's. The query
 *  is the one its own submission page sends. */
async function fetchSubmissionDetailsCn(submissionId: string): Promise<SubmissionDetails | null> {
  const output = `outputDetail { codeOutput expectedOutput compileError runtimeError lastTestcase }`;
  type R = {
    submissionDetail: {
      code: string;
      lang: string;
      langVerboseName: string | null;
      runtimeDisplay: string | null;
      memoryDisplay: string | null;
      timestamp: number | string;
      outputDetail?: {
        codeOutput: string | null;
        expectedOutput: string | null;
        compileError: string | null;
        runtimeError: string | null;
        lastTestcase: string | null;
      } | null;
    } | null;
  };
  const { submissionDetail: d } = await gql<R>(
    `query Q($submissionId: ID!) {
       submissionDetail(submissionId: $submissionId) {
         code timestamp lang langVerboseName
         runtimeDisplay: runtime
         memoryDisplay: memory
         ... on GeneralSubmissionNode { ${output} }
         ... on ContestSubmissionNode { ${output} }
       }
     }`,
    { submissionId },
  );
  if (!d) return null;
  return {
    code: d.code,
    lang: { name: d.lang, verboseName: d.langVerboseName ?? undefined },
    runtimeDisplay: d.runtimeDisplay,
    memoryDisplay: d.memoryDisplay,
    // Empty strings when there's nothing to show, unlike leetcode.com's nulls.
    lastTestcase: d.outputDetail?.lastTestcase || null,
    expectedOutput: d.outputDetail?.expectedOutput || null,
    codeOutput: d.outputDetail?.codeOutput || null,
    runtimeError: d.outputDetail?.runtimeError || null,
    compileError: d.outputDetail?.compileError || null,
    timestamp: Number(d.timestamp),
  };
}

async function fetchSubmissionDetails(submissionId: string): Promise<SubmissionDetails | null> {
  if (LEETCODE_PAGE_SITE === "cn") return fetchSubmissionDetailsCn(submissionId);
  type R = { submissionDetails: SubmissionDetails | null };
  // Modern LC submissionDetails takes `submissionId: Int!`. The id from
  // submissionList comes as a string — coerce it.
  const idInt = parseInt(submissionId, 10);
  if (!Number.isFinite(idInt)) throw new Error(`bad submissionId ${submissionId}`);

  const data = await gql<R>(
    `query Q($submissionId: Int!) {
       submissionDetails(submissionId: $submissionId) {
         code
         lang { name verboseName }
         runtimeDisplay
         memoryDisplay
         lastTestcase
         expectedOutput
         codeOutput
         runtimeError
         compileError
         timestamp
       }
     }`,
    { submissionId: idInt },
  );
  return data.submissionDetails;
}

function parseRuntimeMs(s: string | null): number | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d+)\s*ms/);
  return m ? parseInt(m[1]!, 10) : undefined;
}

function parseMemoryKb(s: string | null): number | undefined {
  if (!s) return undefined;
  const m = s.match(/([\d.]+)\s*(KB|MB)/i);
  if (!m) return undefined;
  const v = parseFloat(m[1]!);
  return m[2]!.toUpperCase() === "MB" ? Math.round(v * 1024) : Math.round(v);
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Full capture rows for the given submissions. Ones whose details fail to
 *  load are skipped; the next sync retries them. */
export async function fetchSubmissionInputs(summaries: SubmissionSummary[]): Promise<CaptureSubmissionInput[]> {
  const results = await mapConcurrent(summaries, 4, async (s): Promise<CaptureSubmissionInput | null> => {
    try {
      const d = await fetchSubmissionDetails(s.id);
      if (!d) {
        console.warn("[ankify] submissionDetails returned null for", s.id);
        return null;
      }
      return {
        leetcodeSubmissionId: s.id,
        language: d.lang.verboseName || d.lang.name,
        code: d.code,
        status: storedVerdict(s.status),
        runtimeMs: parseRuntimeMs(d.runtimeDisplay),
        memoryKb: parseMemoryKb(d.memoryDisplay),
        failedTestcase: d.lastTestcase ?? undefined,
        expectedOutput: d.expectedOutput ?? undefined,
        actualOutput: d.codeOutput ?? undefined,
        errorMessage: d.runtimeError ?? d.compileError ?? undefined,
        submittedAt: new Date(d.timestamp * 1000).toISOString(),
      };
    } catch (err) {
      console.warn("[ankify] submissionDetails failed for", s.id, err);
      return null;
    }
  });
  return results.filter((submission): submission is CaptureSubmissionInput => submission != null);
}

/**
 * Every problem the signed-in LeetCode user has solved, plus their username.
 * `/api/problems/all/` answers both in one same-origin request; the GraphQL
 * `questionList` status filter is the fallback if that endpoint changes.
 * Returns null when nobody is signed in to LeetCode.
 */
export async function fetchSolvedList(): Promise<{ username: string; slugs: string[] } | null> {
  if (LEETCODE_PAGE_SITE === "cn") return fetchSolvedListCn();
  try {
    const res = await fetch("/api/problems/all/", { credentials: "include" });
    if (res.ok) {
      const body = (await res.json()) as {
        user_name?: string;
        stat_status_pairs?: { status: string | null; stat: { question__title_slug: string } }[];
      };
      if (!body.user_name) return null;
      return {
        username: body.user_name,
        slugs: (body.stat_status_pairs ?? [])
          .filter((pair) => pair.status === "ac")
          .map((pair) => pair.stat.question__title_slug),
      };
    }
  } catch (err) {
    console.warn("[ankify] /api/problems/all/ failed; trying GraphQL", err);
  }

  type Status = { userStatus: { username: string; isSignedIn: boolean } };
  const status = await gql<Status>(`query { userStatus { username isSignedIn } }`);
  if (!status.userStatus.isSignedIn || !status.userStatus.username) return null;

  type Page = { questionList: { totalNum: number; data: { titleSlug: string }[] } };
  const PAGE = 100;
  const slugs: string[] = [];
  for (let skip = 0; skip < 10_000; skip += PAGE) {
    const page = await gql<Page>(
      `query Q($skip: Int!, $limit: Int!) {
         questionList(categorySlug: "", limit: $limit, skip: $skip, filters: { status: AC }) {
           totalNum
           data { titleSlug }
         }
       }`,
      { skip, limit: PAGE },
    );
    slugs.push(...page.questionList.data.map((q) => q.titleSlug));
    if (page.questionList.data.length < PAGE || slugs.length >= page.questionList.totalNum) break;
  }
  return { username: status.userStatus.username, slugs };
}

/** On leetcode.cn the account is its `userSlug`: what profile links and profile
 *  queries use, and not always the `user_name` of `/api/problems/all/`. Its
 *  GraphQL fallback is `problemsetQuestionList`. */
async function fetchSolvedListCn(): Promise<{ username: string; slugs: string[] } | null> {
  type Status = { userStatus: { userSlug: string | null; isSignedIn: boolean } };
  const { userStatus } = await gql<Status>(`query { userStatus { userSlug isSignedIn } }`);
  if (!userStatus.isSignedIn || !userStatus.userSlug) return null;
  const username = userStatus.userSlug;

  try {
    const res = await fetch("/api/problems/all/", { credentials: "include" });
    if (res.ok) {
      const body = (await res.json()) as {
        user_name?: string;
        stat_status_pairs?: { status: string | null; stat: { question__title_slug: string } }[];
      };
      // A blank user_name means this response isn't for the signed-in user.
      if (body.user_name) {
        return {
          username,
          slugs: (body.stat_status_pairs ?? [])
            .filter((pair) => pair.status === "ac")
            .map((pair) => pair.stat.question__title_slug),
        };
      }
    }
  } catch (err) {
    console.warn("[ankify] /api/problems/all/ failed; trying GraphQL", err);
  }

  type Page = { problemsetQuestionList: { hasMore: boolean; questions: { titleSlug: string }[] } };
  const PAGE = 100;
  const slugs: string[] = [];
  for (let skip = 0; skip < 10_000; skip += PAGE) {
    const { problemsetQuestionList: page } = await gql<Page>(
      `query Q($skip: Int!, $limit: Int!) {
         problemsetQuestionList(categorySlug: "", limit: $limit, skip: $skip, filters: { status: AC }) {
           hasMore
           questions { titleSlug }
         }
       }`,
      { skip, limit: PAGE },
    );
    slugs.push(...page.questions.map((q) => q.titleSlug));
    if (!page.hasMore) break;
  }
  return { username, slugs };
}

export async function captureCurrent(): Promise<CaptureProblemInput> {
  const slug = slugFromUrl();
  if (!slug) throw new Error("Not a LeetCode problem page");

  const hasCsrf = !!csrfToken();
  console.log("[ankify] capturing", slug, "csrf:", hasCsrf ? "present" : "MISSING");

  const q = await fetchProblem(slug);
  if (!q) throw new Error("Problem not found");

  const recent = await fetchRecentSubmissions(slug, 20);
  console.log(`[ankify] submissionList → ${recent.length} entries`, recent);

  const submissions = await fetchSubmissionInputs(recent.map(toSummary));
  console.log(`[ankify] captured ${submissions.length} submission details`);

  let similarSlugs: string[] = [];
  try {
    const parsed = JSON.parse(q.similarQuestions) as { titleSlug: string }[];
    similarSlugs = parsed.map((p) => p.titleSlug);
  } catch {
    /* leetcode returns this as a JSON-encoded string, sometimes empty */
  }

  return {
    leetcodeSlug: q.titleSlug,
    leetcodeId: parseInt(q.questionFrontendId, 10) || undefined,
    title: q.translatedTitle || q.title,
    difficulty: q.difficulty,
    url: leetcodeProblemUrl(q.titleSlug, LEETCODE_PAGE_SITE),
    descriptionMd: q.translatedContent || (q.content ?? ""),
    topicTags: q.topicTags.map((t) => t.slug),
    similarSlugs,
    submissions,
  };
}
