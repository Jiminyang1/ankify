import type { BrowserContext } from "@playwright/test";

export const fixtureSlug = "valid-parentheses";
export const fixtureUrl = `https://leetcode.com/problems/${fixtureSlug}/`;
export const fixtureCode = "class Solution:\n    def isValid(self, s):\n        return s == '()'";

export type FixtureSubmission = { id: string; statusDisplay: string; timestamp: number; code?: string | null };

/** Mutable LeetCode state; tests append submissions as if the user submitted. */
export type LeetcodeFixtureState = { signedIn: boolean; submissions: FixtureSubmission[] };

export function defaultLeetcodeState(): LeetcodeFixtureState {
  return {
    signedIn: true,
    // Ids grow over time, as on LeetCode: 9003 is the newest.
    submissions: [
      { id: "9003", statusDisplay: "Accepted", timestamp: 1788264000, code: fixtureCode },
      { id: "9002", statusDisplay: "Wrong Answer", timestamp: 1788263900, code: "return False" },
      { id: "9001", statusDisplay: "Runtime Error", timestamp: 1788263800, code: null },
    ],
  };
}

// Synthetic examples matching the currently queried fields, not evidence that
// live LeetCode pagination, account identity, or availability is validated.
export async function installLeetcodeFixture(context: BrowserContext, state: LeetcodeFixtureState = defaultLeetcodeState()) {
  await context.route("https://leetcode.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/problems/${fixtureSlug}/`) {
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><head><title>Valid Parentheses</title></head><body><h1>Valid Parentheses</h1></body></html>" });
    }
    if (url.pathname !== "/graphql/") return route.abort();
    const { query, variables } = route.request().postDataJSON() as { query: string; variables: Record<string, unknown> };
    if (query.includes("userStatus")) {
      return route.fulfill({ json: { data: { userStatus: { isSignedIn: state.signedIn, username: state.signedIn ? "fixture_user" : null } } } });
    }
    if (query.includes("submissionDetails(")) {
      const submission = state.submissions.find((item) => item.id === String(variables.submissionId));
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
      if (!state.signedIn) {
        const key = query.includes("questionSubmissionList(") ? "questionSubmissionList" : "submissionList";
        return route.fulfill({ json: { data: { [key]: null } } });
      }
      const key = query.includes("questionSubmissionList(") ? "questionSubmissionList" : "submissionList";
      const newestFirst = [...state.submissions].sort((a, b) => Number(b.id) - Number(a.id));
      return route.fulfill({ json: { data: { [key]: {
        hasNext: false, lastKey: null,
        submissions: newestFirst.map((item) => ({ id: item.id, statusDisplay: item.statusDisplay, lang: "python3", runtime: "4 ms", memory: "16.5 MB", timestamp: String(item.timestamp) })),
      } } } });
    }
    if (query.includes("question(titleSlug:")) {
      return route.fulfill({ json: { data: { question: {
        questionFrontendId: "20", title: "Valid Parentheses", titleSlug: fixtureSlug, difficulty: "Easy",
        content: "<p>Determine whether the brackets are valid.</p>", topicTags: [{ name: "Stack", slug: "stack" }],
        similarQuestions: JSON.stringify([{ titleSlug: "generate-parentheses", difficulty: "Medium" }]),
      } } } });
    }
    throw new Error(`Unexpected fixture GraphQL operation: ${query.slice(0, 80)}`);
  });
  await context.addCookies([{ name: "csrftoken", value: "fixture-csrf", url: "https://leetcode.com" }]);
  return state;
}
