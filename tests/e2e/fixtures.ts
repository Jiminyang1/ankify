import { test as base, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { resolve } from "node:path";

export const API_ORIGIN = "http://localhost:4317";

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  extensionWorker: Worker;
  panel: Page;
}>({
  context: async ({}, use) => {
    const extension = resolve("apps/extension/dist-e2e");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    // External requests must be supplied by a test fixture. No test reaches
    // the live LeetCode site, analytics, or an AI provider from the browser.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === API_ORIGIN || url.protocol === "chrome-extension:") return route.continue();
      return route.abort("blockedbyclient");
    });
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
    const page = await context.newPage();
    await page.goto(`${API_ORIGIN}/api/qa/login`);
    await page.waitForURL(`${API_ORIGIN}/today`);
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await use(page);
  },
});

export const expect = test.expect;
