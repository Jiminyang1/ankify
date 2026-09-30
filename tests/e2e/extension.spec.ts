import type { CaptureProblemInput, CaptureResultDto } from "../../packages/contracts/src";
import { test, expect, API_ORIGIN } from "./fixtures";
import { fixtureCode, fixtureSlug, fixtureUrl, installLeetcodeFixture } from "./leetcode-fixture";

test("loads the extension, authenticates, captures fixtures, and recovers after worker termination", async ({ context, panel, extensionId, extensionWorker }) => {
  await expect(panel.getByRole("tab", { name: "Today", exact: true })).toBeVisible();
  await installLeetcodeFixture(context);
  const leetcode = await context.newPage();
  await leetcode.goto(fixtureUrl);

  // Real Chrome messaging crosses from the trusted extension into its content
  // script. Wait for document_idle installation instead of a fixed sleep.
  const capture = () => panel.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id == null) throw new Error("Fixture tab missing");
    return chrome.tabs.sendMessage(tab.id, { type: "capture_current_problem" }) as Promise<{ type: string; data: CaptureProblemInput }>;
  }, fixtureUrl);
  await expect.poll(async () => (await capture().catch(() => null))?.type).toBe("captured");
  const { data } = await capture();
  expect(data.leetcodeSlug).toBe(fixtureSlug);
  expect(data.topicTags).toEqual(["Stack"]);
  expect(data.similarSlugs).toEqual(["generate-parentheses"]);
  expect(data.submissions).toHaveLength(2); // Legacy capture drops unavailable details.
  expect(data.submissions[0]).toMatchObject({ leetcodeSubmissionId: "9001", code: fixtureCode, runtimeMs: 4, memoryKb: 16896 });
  expect(data.submissions[1]).toMatchObject({ status: "Wrong Answer", failedTestcase: '"()"', actualOutput: "false" });

  const save = () => panel.evaluate(async ({ origin, payload }) => {
    const response = await fetch(`${origin}/api/capture`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() as CaptureResultDto };
  }, { origin: API_ORIGIN, payload: data });
  const saved = await save();
  expect(saved.status).toBe(200);
  expect(saved.body).toMatchObject({ created: true, importedSubmissions: 2 });

  await extensionWorker.evaluate(() => chrome.storage.local.set({ "ankify.settings": { language: "en", resetCodeOnProblemOpen: true } }));
  // Terminate the actual worker target through CDP, then wake it by messaging
  // from an extension page. Persistent Chrome storage must survive.
  const cdp = await context.newCDPSession(panel);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const target = targetInfos.find((info) => info.type === "service_worker" && info.url.startsWith(`chrome-extension://${extensionId}/`));
  expect(target).toBeDefined();
  const closed = await cdp.send("Target.closeTarget", { targetId: target!.targetId });
  expect(closed.success).toBe(true);
  await expect.poll(() => panel.evaluate(() => chrome.runtime.sendMessage({ type: "get_content_settings" })).catch(() => null))
    .toEqual({ resetCodeOnProblemOpen: true });
  const replay = await save();
  expect(replay.status).toBe(200);
  expect(replay.body).toMatchObject({ problemId: saved.body.problemId, created: false, importedSubmissions: 0 });
  await cdp.detach();
});

test("shows the sign-in state without a QA session", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await expect(page.getByText("Sign in", { exact: false }).first()).toBeVisible();
});
