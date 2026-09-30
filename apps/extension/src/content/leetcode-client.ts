import type { LeetcodeAvailability, PracticeProblemInput, SessionObservationInput } from "@ankify/contracts";
import { compareSubmissionIds } from "@ankify/core";

/**
 * LeetCode adapter for the content script. It calls LeetCode's own GraphQL
 * endpoint with the page's session (same origin, CSRF header), so no cookie
 * or host permission beyond leetcode.com is needed.
 *
 * Every read reports its availability explicitly. A failed or signed-out read
 * is never presented as "no submissions": callers must treat anything other
 * than `available` as unknown.
 */

export type ListedSubmission = {
  id: string;
  verdict: SessionObservationInput["verdict"];
  /** Still being judged; not an outcome yet. */
  pending: boolean;
  submittedAt: string | null;
  language: string | null;
};

export type SubmissionDetail = NonNullable<SessionObservationInput["detail"]>;

export type Read<T> = { availability: LeetcodeAvailability; value: T | null };

type GraphqlResult<T> =
  | { ok: true; data: T }
  | { ok: false; signedOut: boolean; message: string };

export type LeetcodeClientOptions = {
  fetch?: typeof fetch;
  csrfToken?: () => string | null;
  timeoutMs?: number;
};

const KNOWN_VERDICTS = [
  "Accepted",
  "Wrong Answer",
  "Time Limit Exceeded",
  "Memory Limit Exceeded",
  "Runtime Error",
  "Compile Error",
] as const;

/** Verdicts LeetCode shows while a submission is still being judged. */
const PENDING_VERDICTS = new Set(["Pending", "Judging", "Queued", "Running"]);

export function normalizeVerdict(statusDisplay: string): SessionObservationInput["verdict"] {
  return (KNOWN_VERDICTS as readonly string[]).includes(statusDisplay)
    ? (statusDisplay as SessionObservationInput["verdict"])
    : "Other";
}

export function parseRuntimeMs(value: string | null | undefined): number | undefined {
  const match = value?.match(/(\d+)\s*ms/);
  return match ? parseInt(match[1]!, 10) : undefined;
}

export function parseMemoryKb(value: string | null | undefined): number | undefined {
  const match = value?.match(/([\d.]+)\s*(KB|MB)/i);
  if (!match) return undefined;
  const amount = parseFloat(match[1]!);
  return match[2]!.toUpperCase() === "MB" ? Math.round(amount * 1024) : Math.round(amount);
}

function fromUnixSeconds(value: unknown): string | null {
  const seconds = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function readCsrfCookie() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

type RawListedSubmission = { id: string | number; statusDisplay: string; lang?: string | null; timestamp?: string | number | null };
type SubmissionPage = { submissions: RawListedSubmission[]; hasNext?: boolean | null; lastKey?: string | null } | null;

export function createLeetcodeClient(options: LeetcodeClientOptions = {}) {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const csrfToken = options.csrfToken ?? readCsrfCookie;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let paginationSupported = true;

  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<GraphqlResult<T>> {
    const token = csrfToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch("/graphql/", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...(token ? { "x-csrftoken": token } : {}) },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return { ok: false, signedOut: true, message: `http ${response.status}` };
      if (!response.ok) return { ok: false, signedOut: false, message: `http ${response.status}` };
      const body = (await response.json()) as { data?: T; errors?: { message?: string }[] };
      if (body.errors?.length) return { ok: false, signedOut: false, message: body.errors.map((error) => error.message ?? "").join("; ") };
      if (!body.data) return { ok: false, signedOut: false, message: "empty response" };
      return { ok: true, data: body.data };
    } catch (error) {
      return { ok: false, signedOut: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Metadata the practice-session API needs to create a problem. */
  async function readProblem(slug: string): Promise<Read<PracticeProblemInput>> {
    type Question = {
      questionFrontendId: string;
      title: string;
      titleSlug: string;
      difficulty: "Easy" | "Medium" | "Hard";
      content: string | null;
      topicTags: { name: string }[] | null;
      similarQuestions: string | null;
    };
    const result = await graphql<{ question: Question | null }>(
      `query ankifyQuestion($slug: String!) {
         question(titleSlug: $slug) {
           questionFrontendId title titleSlug difficulty content topicTags { name } similarQuestions
         }
       }`,
      { slug },
    );
    if (!result.ok) return { availability: result.signedOut ? "signed_out" : "unavailable", value: null };
    const question = result.data.question;
    if (!question) return { availability: "unavailable", value: null };
    let similarSlugs: string[] = [];
    try {
      similarSlugs = (JSON.parse(question.similarQuestions ?? "[]") as { titleSlug?: string }[])
        .flatMap((item) => (typeof item.titleSlug === "string" ? [item.titleSlug] : []))
        .slice(0, 64);
    } catch {
      // LeetCode returns a JSON-encoded string, sometimes empty.
    }
    return {
      availability: "available",
      value: {
        leetcodeSlug: question.titleSlug,
        leetcodeId: parseInt(question.questionFrontendId, 10) || undefined,
        title: question.title.slice(0, 512),
        difficulty: question.difficulty,
        url: `https://leetcode.com/problems/${question.titleSlug}/`,
        descriptionMd: (question.content ?? "").slice(0, 200_000),
        topicTags: (question.topicTags ?? []).map((tag) => tag.name.slice(0, 64)).slice(0, 64),
        similarSlugs,
      },
    };
  }

  /** The signed-in LeetCode username, used to keep one account per session. */
  async function readAccount(): Promise<Read<{ username: string }>> {
    if (!csrfToken()) return { availability: "signed_out", value: null };
    const result = await graphql<{ userStatus: { isSignedIn: boolean; username: string | null } | null }>(
      `query ankifyUserStatus { userStatus { isSignedIn username } }`,
    );
    if (!result.ok) return { availability: result.signedOut ? "signed_out" : "unavailable", value: null };
    const status = result.data.userStatus;
    if (!status?.isSignedIn) return { availability: "signed_out", value: null };
    const username = status.username && /^[A-Za-z0-9_.-]{1,64}$/.test(status.username) ? status.username : null;
    return { availability: "available", value: username ? { username } : null };
  }

  async function listPage(slug: string, offset: number, limit: number, lastKey: string | null): Promise<GraphqlResult<SubmissionPage>> {
    if (paginationSupported) {
      const result = await graphql<{ questionSubmissionList: SubmissionPage }>(
        `query ankifySubmissions($questionSlug: String!, $offset: Int!, $limit: Int!, $lastKey: String) {
           questionSubmissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit, lastKey: $lastKey) {
             lastKey hasNext submissions { id statusDisplay lang timestamp }
           }
         }`,
        { questionSlug: slug, offset, limit, lastKey },
      );
      if (result.ok) return { ok: true, data: result.data.questionSubmissionList };
      if (!/hasNext|lastKey|Cannot query field/i.test(result.message)) return result;
      // LeetCode rejected the pagination fields: keep working one page at a time.
      paginationSupported = false;
    }
    const legacy = await graphql<{ questionSubmissionList: SubmissionPage }>(
      `query ankifySubmissionsLegacy($questionSlug: String!, $offset: Int!, $limit: Int!, $lastKey: String) {
         questionSubmissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit, lastKey: $lastKey) {
           submissions { id statusDisplay lang timestamp }
         }
       }`,
      { questionSlug: slug, offset, limit, lastKey },
    );
    return legacy.ok ? { ok: true, data: legacy.data.questionSubmissionList } : legacy;
  }

  /**
   * Submissions newest first, reading pages until one reaches `stopAtId` (the
   * baseline or the newest already reported), the list ends, or `maxPages`.
   * `complete` is false when the scan stopped early, so a caller never treats
   * an unread tail as empty.
   */
  async function listSubmissions(
    slug: string,
    options: { stopAtId?: string | null; maxPages?: number; pageSize?: number } = {},
  ): Promise<Read<{ submissions: ListedSubmission[]; complete: boolean }>> {
    if (!csrfToken()) return { availability: "signed_out", value: null };
    const pageSize = options.pageSize ?? 20;
    const maxPages = options.maxPages ?? 3;
    const submissions: ListedSubmission[] = [];
    let lastKey: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await listPage(slug, page * pageSize, pageSize, lastKey);
      if (!result.ok) {
        return page === 0
          ? { availability: result.signedOut ? "signed_out" : "unavailable", value: null }
          : { availability: "partial", value: { submissions, complete: false } };
      }
      // LeetCode answers a signed-out request with a null list.
      if (!result.data) return page === 0 ? { availability: "signed_out", value: null } : { availability: "partial", value: { submissions, complete: false } };
      const rows = result.data.submissions ?? [];
      let reachedStop = false;
      for (const row of rows) {
        const id = String(row.id);
        if (options.stopAtId && (compareSubmissionIds(id, options.stopAtId) ?? 1) <= 0) {
          reachedStop = true;
          break;
        }
        submissions.push({
          id,
          verdict: normalizeVerdict(row.statusDisplay),
          pending: PENDING_VERDICTS.has(row.statusDisplay),
          submittedAt: fromUnixSeconds(row.timestamp),
          language: row.lang ?? null,
        });
      }
      const hasNext = result.data.hasNext ?? rows.length === pageSize;
      if (reachedStop || !hasNext || !paginationSupported) {
        return { availability: "available", value: { submissions, complete: reachedStop || !hasNext } };
      }
      lastKey = result.data.lastKey ?? null;
    }
    return { availability: "available", value: { submissions, complete: false } };
  }

  /** Code and judge output; `null` value when LeetCode withholds it. */
  async function readSubmissionDetail(id: string): Promise<Read<SubmissionDetail>> {
    const numericId = Number(id);
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(numericId)) return { availability: "unavailable", value: null };
    type Details = {
      code: string | null;
      lang: { name: string; verboseName?: string | null } | null;
      runtimeDisplay: string | null;
      memoryDisplay: string | null;
      lastTestcase: string | null;
      expectedOutput: string | null;
      codeOutput: string | null;
      runtimeError: string | null;
      compileError: string | null;
    };
    const result = await graphql<{ submissionDetails: Details | null }>(
      `query ankifySubmissionDetails($submissionId: Int!) {
         submissionDetails(submissionId: $submissionId) {
           code lang { name verboseName } runtimeDisplay memoryDisplay lastTestcase
           expectedOutput codeOutput runtimeError compileError
         }
       }`,
      { submissionId: numericId },
    );
    if (!result.ok) return { availability: result.signedOut ? "signed_out" : "unavailable", value: null };
    const details = result.data.submissionDetails;
    if (!details || typeof details.code !== "string") return { availability: "partial", value: null };
    const clip = (value: string | null, max: number) => (value == null ? undefined : value.slice(0, max));
    return {
      availability: "available",
      value: {
        language: (details.lang?.verboseName || details.lang?.name || "unknown").slice(0, 64),
        code: details.code.slice(0, 100_000),
        runtimeMs: parseRuntimeMs(details.runtimeDisplay),
        memoryKb: parseMemoryKb(details.memoryDisplay),
        failedTestcase: clip(details.lastTestcase, 20_000),
        expectedOutput: clip(details.expectedOutput, 20_000),
        actualOutput: clip(details.codeOutput, 20_000),
        errorMessage: clip(details.runtimeError ?? details.compileError, 10_000),
      },
    };
  }

  return { readProblem, readAccount, listSubmissions, readSubmissionDetail };
}

export type LeetcodeClient = ReturnType<typeof createLeetcodeClient>;
