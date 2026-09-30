import { test as base, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { resolve } from "node:path";
import { installLeetcodeFixture, type LeetcodeFixtureState } from "./leetcode-fixture";

export const API_ORIGIN = "http://localhost:4317";
export const EXTENSION_PATH = resolve("apps/extension/dist-e2e");

type Api = <T>(path: string, init?: { body?: unknown; method?: string }) => Promise<T>;

export async function launchExtensionContext(userDataDir = "") {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  // External requests must be supplied by a test fixture. No test reaches
  // the live LeetCode site, analytics, or an AI provider from the browser.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === API_ORIGIN || url.protocol === "chrome-extension:") return route.continue();
    return route.abort("blockedbyclient");
  });
  return context;
}

export async function openSignedInPopup(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`${API_ORIGIN}/api/qa/login`);
  await page.waitForURL(`${API_ORIGIN}/today`);
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  return page;
}

/** Calls the Ankify API with the QA session from an extension page. */
export function apiFrom(page: Page): Api {
  return (path, init = {}) =>
    page.evaluate(async ({ origin, path, body, method }) => {
      const response = await fetch(`${origin}${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return response.json();
    }, { origin: API_ORIGIN, path, body: init.body, method: init.method });
}

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  extensionWorker: Worker;
  panel: Page;
  leetcode: LeetcodeFixtureState;
  api: Api;
}>({
  context: async ({}, use) => {
    const context = await launchExtensionContext();
    try { await use(context); } finally { await context.close(); }
  },
  extensionWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await use(worker);
  },
  extensionId: async ({ extensionWorker }, use) => {
    await use(new URL(extensionWorker.url()).host);
  },
  panel: async ({ context, extensionId }, use) => {
    await use(await openSignedInPopup(context, extensionId));
  },
  leetcode: async ({ context }, use) => {
    await use(await installLeetcodeFixture(context));
  },
  api: async ({ panel }, use) => {
    await use(apiFrom(panel));
  },
});

export const expect = test.expect;
