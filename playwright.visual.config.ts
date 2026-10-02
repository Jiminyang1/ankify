import { defineConfig } from "@playwright/test";

/**
 * Screenshot regression for the LeetCode-native design: the panel, the popup,
 * and the web app in light and dark, at fixed viewports, on the deterministic
 * QA seed. Run with `pnpm test:visual`. Update baselines only after looking at
 * the new screenshots (`pnpm test:visual --update-snapshots`), never blindly.
 */
export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    // Font rasterization differs slightly between runs; real changes are larger.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" },
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:4317", trace: "retain-on-failure" },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://localhost:4317/api/auth/get-session",
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
