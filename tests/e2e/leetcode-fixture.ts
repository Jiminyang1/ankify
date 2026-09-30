import type { BrowserContext } from "@playwright/test";

export const fixtureSlug = "valid-parentheses";
export const fixtureUrl = `https://leetcode.com/problems/${fixtureSlug}/`;
export const fixtureCode = "class Solution:\n    def isValid(self, s):\n        return s == '()'";

// Synthetic examples matching the currently queried fields, not evidence that
// live LeetCode pagination, account identity, or availability is validated.
export async function installLeetcodeFixture(context: BrowserContext) {
  await context.route("https://leetcode.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/problems/${fixtureSlug}/`) {
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><head><title>Valid Parentheses</title></head><body><h1>Valid Parentheses</h1></body></html>" });
    }
    if (url.pathname !== "/graphql/") return route.abort();
    const { query, variables } = route.request().postDataJSON() as { query: string; variables: Record<string, unknown> };
    if (query.includes("submissionDetails(")) {
      const id = Number(variables.submissionId);
      return route.fulfill({ json: { data: { submissionDetails: id === 9003 ? null : {
        code: id === 9001 ? fixtureCode : "return False", lang: { name: "python3", verboseName: "Python3" },
        runtimeDisplay: "4 ms", memoryDisplay: "16.5 MB", lastTestcase: id === 9002 ? '"()"' : null,
        expectedOutput: id === 9002 ? "true" : null, codeOutput: id === 9002 ? "false" : null,
        runtimeError: null, compileError: null, timestamp: 1788264000,
      } } } });
    }
    if (query.includes("SubmissionList(") || query.includes("submissionList(")) {
      const key = query.includes("questionSubmissionList(") ? "questionSubmissionList" : "submissionList";
      return route.fulfill({ json: { data: { [key]: { submissions: [
        { id: "9001", statusDisplay: "Accepted", lang: "python3", runtime: "4 ms", memory: "16.5 MB", timestamp: "1788264000" },
        { id: "9002", statusDisplay: "Wrong Answer", lang: "python3", runtime: "N/A", memory: "N/A", timestamp: "1788263900" },
        { id: "9003", statusDisplay: "Runtime Error", lang: "python3", runtime: "N/A", memory: "N/A", timestamp: "1788263800" },
      ] } } } });
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
}
