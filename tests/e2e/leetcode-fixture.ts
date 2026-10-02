import type { BrowserContext } from "@playwright/test";

export const fixtureSlug = "valid-parentheses";
export const fixtureUrl = `https://leetcode.com/problems/${fixtureSlug}/`;
export const fixtureCode = "class Solution:\n    def isValid(self, s):\n        return s == '()'";

export type FixtureSubmission = { id: string; statusDisplay: string; timestamp: number; code?: string | null };
export type FixtureProblem = { frontendId: number; title: string; submissions: FixtureSubmission[] };

/** Mutable LeetCode state; tests add problems and append submissions as if the user submitted. */
export type LeetcodeFixtureState = { signedIn: boolean; problems: Record<string, FixtureProblem> };

export const problemUrl = (slug: string) => `https://leetcode.com/problems/${slug}/`;

export function defaultLeetcodeState(): LeetcodeFixtureState {
  return {
    signedIn: true,
    problems: {
      // Ids grow over time, as on LeetCode: 9003 is the newest.
      [fixtureSlug]: {
        frontendId: 20,
        title: "Valid Parentheses",
        submissions: [
          { id: "9003", statusDisplay: "Accepted", timestamp: 1788264000, code: fixtureCode },
          { id: "9002", statusDisplay: "Wrong Answer", timestamp: 1788263900, code: "return False" },
          { id: "9001", statusDisplay: "Runtime Error", timestamp: 1788263800, code: null },
        ],
      },
    },
  };
}

// Playwright reloads this module in a new worker after a failure. Ids must
// not restart then: the run's database already holds them, and a reused id
// belongs to an earlier session. Time-based ids keep growing across reloads.
let nextSubmissionId = Date.now();

/** Records a judged submission "now", newer than any existing one. */
export function submit(state: LeetcodeFixtureState, slug: string, statusDisplay: string, code = "return 1") {
  const submission = { id: String(nextSubmissionId++), statusDisplay, timestamp: Math.floor(Date.now() / 1000), code };
  state.problems[slug]!.submissions.unshift(submission);
  return submission;
}

/** Records a submission LeetCode is still judging; set its `statusDisplay` to judge it. */
export function submitJudging(state: LeetcodeFixtureState, slug: string, code = "return 1") {
  return submit(state, slug, "Pending", code);
}

// Synthetic examples matching the currently queried fields, not evidence that
// live LeetCode pagination, account identity, or availability is validated.
export async function installLeetcodeFixture(context: BrowserContext, state: LeetcodeFixtureState = defaultLeetcodeState()) {
  const findSubmission = (id: string) =>
    Object.values(state.problems).flatMap((problem) => problem.submissions).find((item) => item.id === id);
  await context.route("https://leetcode.com/**", async (route) => {
    const url = new URL(route.request().url());
    const pageSlug = url.pathname.match(/^\/problems\/([^/]+)\//)?.[1];
    if (pageSlug && state.problems[pageSlug]) {
      const title = state.problems[pageSlug]!.title;
      // LeetCode's Submit button, as the content script recognizes it.
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><button type="button" data-e2e-locator="console-submit-button">Submit</button></body></html>`,
      });
    }
    if (url.pathname !== "/graphql/") return route.abort();
    const { query, variables } = route.request().postDataJSON() as { query: string; variables: Record<string, unknown> };
    if (query.includes("userStatus")) {
      return route.fulfill({ json: { data: { userStatus: { isSignedIn: state.signedIn, username: state.signedIn ? "fixture_user" : null } } } });
    }
    if (query.includes("submissionDetails(")) {
      const submission = findSubmission(String(variables.submissionId));
      if (!submission || submission.code == null) return route.fulfill({ json: { data: { submissionDetails: null } } });
      const failed = submission.statusDisplay !== "Accepted";
      return route.fulfill({ json: { data: { submissionDetails: {
        code: submission.code, lang: { name: "python3", verboseName: "Python3" },
        runtimeDisplay: "4 ms", memoryDisplay: "16.5 MB", lastTestcase: failed ? '"()"' : null,
        expectedOutput: failed ? "true" : null, codeOutput: failed ? "false" : null,
        runtimeError: null, compileError: null, timestamp: submission.timestamp,
      } } } });
    }
    if (query.includes("SubmissionList(") || query.includes("submissionList(")) {
      const key = query.includes("questionSubmissionList(") ? "questionSubmissionList" : "submissionList";
      const problem = state.problems[String(variables.questionSlug)];
      // Signed out, the csrftoken cookie stays, and the list just comes back
      // empty: only userStatus tells the page that nobody is signed in.
      if (!state.signedIn) return route.fulfill({ json: { data: { [key]: { hasNext: false, lastKey: null, submissions: [] } } } });
      const newestFirst = [...(problem?.submissions ?? [])].sort((a, b) => Number(b.id) - Number(a.id));
      return route.fulfill({ json: { data: { [key]: {
        hasNext: false, lastKey: null,
        submissions: newestFirst.map((item) => ({ id: item.id, statusDisplay: item.statusDisplay, lang: "python3", runtime: "4 ms", memory: "16.5 MB", timestamp: String(item.timestamp) })),
      } } } });
    }
    if (query.includes("question(titleSlug:")) {
      const slug = String(variables.slug);
      const problem = state.problems[slug];
      if (!problem) return route.fulfill({ json: { data: { question: null } } });
      return route.fulfill({ json: { data: { question: {
        questionFrontendId: String(problem.frontendId), title: problem.title, titleSlug: slug, difficulty: "Easy",
        content: `<p>${problem.title}</p>`, topicTags: [{ name: "Stack", slug: "stack" }],
        similarQuestions: JSON.stringify([{ titleSlug: "generate-parentheses", difficulty: "Medium" }]),
      } } } });
    }
    throw new Error(`Unexpected fixture GraphQL operation: ${query.slice(0, 80)}`);
  });
  await context.addCookies([{ name: "csrftoken", value: "fixture-csrf", url: "https://leetcode.com" }]);
  return state;
}
