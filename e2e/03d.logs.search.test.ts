import { expect, Page, test } from "@playwright/test";
import { LogsFlow } from "./flows/LogsFlow";

const NEEDLE = "health";

test.beforeEach(async ({ page }) => {
  await LogsFlow.open(page, "trickle");
});

test("searching highlights every match, and stepping back through them leaves the stream", async ({ page }) => {
  // when
  await page.getByRole("button", { name: /^Search/ }).click();
  await page.getByPlaceholder("Type to search").fill(NEEDLE);

  // then
  await expect(async () => {
    const lines = await LogsFlow.snapshot(page);
    const matching = lines.filter((line) => line.text.includes(NEEDLE));
    expect(matching.length).toBeGreaterThan(0);
    expect(lines.filter((line) => line.match).length).toBe(matching.length);
    expect(matching.every((line) => line.match)).toBe(true);
  }).toPass();

  // when
  const previous = page.getByTitle("previous match");
  // a screen holds a handful of matches, so leaving it takes a few steps and never anywhere near this many
  for (let step = 0; step < 30 && !(await LogsFlow.jumpToLiveButton(page).isVisible()); step++) {
    await previous.click();
    await expect(page.locator('[data-match="main_match"]')).toBeInViewport();
  }

  // then
  await expect(page.locator('[data-match="main_match"]')).toContainText(NEEDLE);
  await LogsFlow.expectPaused(page);
});

test.describe("dismissing the search", () => {
  type TestCase = {
    name: string;
    dismiss: (page: Page) => Promise<void>;
  };
  const testCases: TestCase[] = [
    { name: "with escape", dismiss: (page) => page.keyboard.press("Escape") },
    { name: "with the search button", dismiss: (page) => page.getByRole("button", { name: /^Search/ }).click() },
  ];
  for (const { name, dismiss } of testCases) {
    test(name, async ({ page }) => {
      // given
      await page.getByRole("button", { name: /^Search/ }).click();
      await page.getByPlaceholder("Type to search").fill(NEEDLE);
      await expect(page.locator("[data-match]").first()).toBeVisible();

      // when
      await dismiss(page);

      // then
      await expect(page.getByPlaceholder("Type to search")).not.toBeVisible();
      await expect(page.locator("[data-match]")).toHaveCount(0);
    });
  }
});
