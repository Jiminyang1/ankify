import { API_ORIGIN, test, expect } from "./fixtures";

// Without the popup fixture this context is signed out, so "/" is the landing.
test("the public landing page describes the extension-first product", async ({ context }) => {
  const page = await context.newPage();
  await page.goto(`${API_ORIGIN}/`);
  await expect(page.getByRole("heading", { level: 1, name: "Remember the reasoning behind every solution." })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Session analysis is optional and runs only on your own", { exact: false })).toBeVisible();
  await expect(page.getByText(/Study Coach|AI quizzes|free AI credits/)).toHaveCount(0);
  await page.close();
});
