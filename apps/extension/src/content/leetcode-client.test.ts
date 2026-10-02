import { describe, expect, it, vi } from "vitest";
import { createLeetcodeClient, parseSimilarQuestions } from "./leetcode-client";

type Handler = (query: string, variables: Record<string, unknown>) => Response | { data?: unknown; errors?: { message: string }[] };

function fakeLeetcode(handler: Handler, csrf: string | null = "csrf") {
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    const result = handler(query, variables);
    return result instanceof Response ? result : Response.json(result);
  });
  return { client: createLeetcodeClient({ fetch: fetch as unknown as typeof globalThis.fetch, csrfToken: () => csrf }), fetch };
}

const listed = (id: number, statusDisplay = "Wrong Answer") => ({ id: String(id), statusDisplay, lang: "python3", timestamp: String(1_790_000_000 + id) });

describe("LeetCode client", () => {
  it("reads problem metadata and reports failures explicitly", async () => {
    const question = { questionFrontendId: "20", title: "Valid Parentheses", titleSlug: "valid-parentheses", difficulty: "Easy", content: "<p>x</p>",
      topicTags: [{ name: "Stack" }], similarQuestions: JSON.stringify([{ titleSlug: "generate-parentheses" }, { bad: true }]) };
    expect(await fakeLeetcode(() => ({ data: { question } })).client.readProblem("valid-parentheses")).toEqual({
      availability: "available",
      value: { leetcodeSlug: "valid-parentheses", leetcodeId: 20, title: "Valid Parentheses", difficulty: "Easy", url: "https://leetcode.com/problems/valid-parentheses/",
        descriptionMd: "<p>x</p>", topicTags: ["Stack"], similarSlugs: ["generate-parentheses"], similarQuestions: [] },
    });
    expect(await fakeLeetcode(() => new Response("", { status: 403 })).client.readProblem("x")).toEqual({ availability: "signed_out", value: null });
    expect(await fakeLeetcode(() => ({ errors: [{ message: "boom" }] })).client.readProblem("x")).toEqual({ availability: "unavailable", value: null });
    expect(await fakeLeetcode(() => ({ data: { question: null } })).client.readProblem("x")).toEqual({ availability: "unavailable", value: null });
  });

  it("keeps a similar question's metadata only when all of it is present", () => {
    const raw = JSON.stringify([
      { title: "Generate Parentheses", titleSlug: "generate-parentheses", difficulty: "Medium", translatedTitle: null, isPaidOnly: false },
      { title: "Remove Invalid Parentheses", titleSlug: "remove-invalid-parentheses", difficulty: "Hard", isPaidOnly: true },
      { title: "Check Validity", titleSlug: "check-validity", difficulty: "Medium" },
      { title: "", titleSlug: "no-title", difficulty: "Easy", isPaidOnly: false },
      { title: "Odd", titleSlug: "odd", difficulty: "Unknown", isPaidOnly: false },
      { title: "Bad Slug", titleSlug: "Bad_Slug", difficulty: "Easy", isPaidOnly: false },
      null,
    ]);
    expect(parseSimilarQuestions(raw)).toEqual({
      similarSlugs: ["generate-parentheses", "remove-invalid-parentheses", "check-validity", "no-title", "odd"],
      similarQuestions: [
        { slug: "generate-parentheses", title: "Generate Parentheses", difficulty: "Medium", paidOnly: false },
        { slug: "remove-invalid-parentheses", title: "Remove Invalid Parentheses", difficulty: "Hard", paidOnly: true },
      ],
    });
    for (const unusable of [null, "", "not json", "{}", "[1,2]"]) {
      expect(parseSimilarQuestions(unusable)).toEqual({ similarSlugs: [], similarQuestions: [] });
    }
  });

  it("identifies the signed-in account only when LeetCode says so", async () => {
    expect(await fakeLeetcode(() => ({ data: { userStatus: { isSignedIn: true, username: "leet_user" } } })).client.readAccount())
      .toEqual({ availability: "available", value: { username: "leet_user" } });
    expect(await fakeLeetcode(() => ({ data: { userStatus: { isSignedIn: false, username: null } } })).client.readAccount())
      .toEqual({ availability: "signed_out", value: null });
    expect(await fakeLeetcode(() => ({ data: {} }), null).client.readAccount()).toEqual({ availability: "signed_out", value: null });
  });

  it("never reports a failed or signed-out listing as zero submissions", async () => {
    // LeetCode answers the submissions query with `list`, and says whether anyone is signed in.
    const leetcode = (list: Response | { data?: unknown; errors?: { message: string }[] }, isSignedIn: boolean | null) =>
      fakeLeetcode((query) => (query.includes("userStatus") ? { data: { userStatus: isSignedIn == null ? null : { isSignedIn } } } : list)).client;
    const empty = { data: { questionSubmissionList: { submissions: [], hasNext: false, lastKey: null } } };
    const signedOut = { availability: "signed_out", value: null };

    expect(await fakeLeetcode(() => ({ data: {} }), null).client.listSubmissions("x")).toEqual(signedOut);
    // Signing out keeps the csrftoken cookie: whatever shape the anonymous
    // answer takes (null, empty, or an error), LeetCode's own status decides.
    expect(await leetcode({ data: { questionSubmissionList: null } }, false).listSubmissions("x")).toEqual(signedOut);
    expect(await leetcode(empty, false).listSubmissions("x")).toEqual(signedOut);
    expect(await leetcode({ errors: [{ message: "User is not authenticated" }] }, false).listSubmissions("x")).toEqual(signedOut);
    // Signed in, or not known: never called signed out.
    expect(await leetcode(empty, true).listSubmissions("x")).toEqual({ availability: "available", value: { submissions: [], complete: true } });
    expect(await leetcode(empty, null).listSubmissions("x")).toEqual({ availability: "available", value: { submissions: [], complete: true } });
    expect(await leetcode({ data: { questionSubmissionList: null } }, true).listSubmissions("x")).toEqual({ availability: "unavailable", value: null });
    expect(await leetcode({ errors: [{ message: "boom" }] }, true).listSubmissions("x")).toEqual({ availability: "unavailable", value: null });
    expect(await fakeLeetcode(() => new Response("", { status: 502 })).client.listSubmissions("x")).toEqual({ availability: "unavailable", value: null });
    // A listing with submissions needs no second check.
    const { client, fetch } = fakeLeetcode(() => ({ data: { questionSubmissionList: { submissions: [listed(7)], hasNext: false, lastKey: null } } }));
    expect(await client.listSubmissions("x")).toMatchObject({ availability: "available", value: { submissions: [{ id: "7" }] } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("pages with lastKey until the baseline, flags submissions still being judged", async () => {
    const pages: Record<string, unknown> = {
      first: { submissions: [listed(1010, "Pending"), listed(1009, "Accepted")], hasNext: true, lastKey: "k1" },
      k1: { submissions: [listed(1008), listed(1000), listed(999)], hasNext: true, lastKey: "k2" },
    };
    const { client, fetch } = fakeLeetcode((_query, variables) => ({ data: { questionSubmissionList: pages[(variables.lastKey as string | null) ?? "first"] } }));
    const result = await client.listSubmissions("x", { stopAtId: "1000", pageSize: 2 });
    expect(result).toEqual({
      availability: "available",
      value: {
        complete: true,
        submissions: [
          { id: "1010", verdict: "Other", pending: true, submittedAt: new Date((1_790_000_000 + 1010) * 1000).toISOString(), language: "python3" },
          { id: "1009", verdict: "Accepted", pending: false, submittedAt: new Date((1_790_000_000 + 1009) * 1000).toISOString(), language: "python3" },
          { id: "1008", verdict: "Wrong Answer", pending: false, submittedAt: new Date((1_790_000_000 + 1008) * 1000).toISOString(), language: "python3" },
        ],
      },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("marks a scan cut short by the page budget or a failing page as incomplete", async () => {
    const endless = fakeLeetcode((_query, variables) => ({ data: { questionSubmissionList: { submissions: [listed(Number(variables.offset) + 1)], hasNext: true, lastKey: `k${variables.offset}` } } }));
    expect(await endless.client.listSubmissions("x", { maxPages: 2, pageSize: 1 })).toMatchObject({ availability: "available", value: { complete: false } });
    let calls = 0;
    const flaky = fakeLeetcode(() => (calls++ === 0 ? { data: { questionSubmissionList: { submissions: [listed(5)], hasNext: true, lastKey: "k" } } } : new Response("", { status: 500 })));
    expect(await flaky.client.listSubmissions("x", { pageSize: 1 })).toMatchObject({ availability: "partial", value: { complete: false, submissions: [{ id: "5" }] } });
  });

  it("falls back to single pages when LeetCode rejects the pagination fields", async () => {
    const { client, fetch } = fakeLeetcode((query) =>
      query.includes("hasNext")
        ? { errors: [{ message: 'Cannot query field "hasNext" on type "SubmissionList".' }] }
        : { data: { questionSubmissionList: { submissions: [listed(3), listed(2)] } } },
    );
    expect(await client.listSubmissions("x", { pageSize: 2 })).toMatchObject({ availability: "available", value: { complete: false, submissions: [{ id: "3" }, { id: "2" }] } });
    await client.listSubmissions("x", { pageSize: 2 });
    expect(fetch.mock.calls.filter(([, init]) => String(init?.body).includes("hasNext"))).toHaveLength(1);
  });

  it("reads and bounds submission details, and reports withheld details as partial", async () => {
    const detail = { code: "x".repeat(100_010), lang: { name: "python3", verboseName: "Python3" }, runtimeDisplay: "4 ms", memoryDisplay: "16.5 MB",
      lastTestcase: '"()"', expectedOutput: "true", codeOutput: "false", runtimeError: null, compileError: null };
    const read = await fakeLeetcode(() => ({ data: { submissionDetails: detail } })).client.readSubmissionDetail("9002");
    expect(read).toMatchObject({ availability: "available", value: { language: "Python3", runtimeMs: 4, memoryKb: 16896, failedTestcase: '"()"', actualOutput: "false" } });
    expect(read.value!.code).toHaveLength(100_000);
    expect(await fakeLeetcode(() => ({ data: { submissionDetails: null } })).client.readSubmissionDetail("9003")).toEqual({ availability: "partial", value: null });
    expect(await fakeLeetcode(() => ({ data: {} })).client.readSubmissionDetail("12abc")).toEqual({ availability: "unavailable", value: null });
  });
});
