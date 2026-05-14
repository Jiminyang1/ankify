import type { CapturedProblem, CapturedSubmission, SubmissionStatus } from "../shared/messages";

/**
 * LeetCode page extraction.
 *
 * Strategy: prefer their public GraphQL endpoint (same one the page uses) for
 * structured fields. Fall back to DOM scraping for the title if GraphQL fails.
 *
 * The submission list and per-submission details are also fetched via GraphQL.
 */

const GRAPHQL = "/graphql/";

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
  const res = await fetch(GRAPHQL, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-csrftoken": token } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
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
      topicTags: { slug: string; name: string }[];
      similarQuestions: string;
    } | null;
  };
  const data = await gql<R>(
    `query Q($slug: String!) {
       question(titleSlug: $slug) {
         questionFrontendId title titleSlug difficulty content
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
  lang: string;
  runtime: string;
  memory: string;
  timestamp: string;
};

/** Two GraphQL ops cover the current and legacy LeetCode submission listing.
 *  Modern site (~2023+) uses `questionSubmissionList`; the old `submissionList`
 *  still resolves on some endpoints. We try modern first, fall back. */
async function fetchRecentSubmissions(slug: string, limit = 5): Promise<RawSubmission[]> {
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

async function fetchSubmissionDetails(submissionId: string) {
  type R = {
    submissionDetails: {
      code: string;
      lang: { name: string; verboseName?: string };
      statusDisplay?: string;
      statusCode?: number;
      runtimeDisplay: string | null;
      memoryDisplay: string | null;
      lastTestcase: string | null;
      expectedOutput: string | null;
      codeOutput: string | null;
      runtimeError: string | null;
      compileError: string | null;
      timestamp: number;
    } | null;
  };
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

function normaliseStatus(s: string): SubmissionStatus {
  const known: SubmissionStatus[] = [
    "Accepted",
    "Wrong Answer",
    "Time Limit Exceeded",
    "Memory Limit Exceeded",
    "Runtime Error",
    "Compile Error",
  ];
  return (known.find((k) => k === s) ?? "Other") as SubmissionStatus;
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

export async function captureCurrent(): Promise<CapturedProblem> {
  const slug = slugFromUrl();
  if (!slug) throw new Error("Not a LeetCode problem page");

  const hasCsrf = !!csrfToken();
  console.log("[ankify] capturing", slug, "csrf:", hasCsrf ? "present" : "MISSING");

  const q = await fetchProblem(slug);
  if (!q) throw new Error("Problem not found");

  const recent = await fetchRecentSubmissions(slug, 20);
  console.log(`[ankify] submissionList → ${recent.length} entries`, recent);

  const submissions: CapturedSubmission[] = [];
  for (const s of recent) {
    try {
      const d = await fetchSubmissionDetails(s.id);
      if (!d) {
        console.warn("[ankify] submissionDetails returned null for", s.id);
        continue;
      }
      submissions.push({
        leetcodeSubmissionId: s.id,
        language: d.lang.verboseName || d.lang.name,
        code: d.code,
        status: normaliseStatus(d.statusDisplay ?? s.statusDisplay),
        runtimeMs: parseRuntimeMs(d.runtimeDisplay),
        memoryKb: parseMemoryKb(d.memoryDisplay),
        failedTestcase: d.lastTestcase ?? undefined,
        expectedOutput: d.expectedOutput ?? undefined,
        actualOutput: d.codeOutput ?? undefined,
        errorMessage: d.runtimeError ?? d.compileError ?? undefined,
        submittedAt: new Date(d.timestamp * 1000).toISOString(),
      });
    } catch (err) {
      console.warn("[ankify] submissionDetails failed for", s.id, err);
    }
  }
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
    title: q.title,
    difficulty: q.difficulty,
    url: `https://leetcode.com/problems/${q.titleSlug}/`,
    descriptionMd: q.content ?? "",
    topicTags: q.topicTags.map((t) => t.name),
    similarSlugs,
    submissions,
  };
}
