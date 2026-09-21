import { expect, test } from "@playwright/test";
import { LogsFlow } from "./flows/LogsFlow";

test.beforeEach(async ({ page }) => {
  // ~400 lines a second against a budget of 150; see `compose-deps.yaml`
  await LogsFlow.open(page, "firehose");
});

test("a throttled second is marked in the log, with how many lines it cost", async ({ page }) => {
  // when
  const throttled = LogsFlow.rows(page).filter({ hasText: "was throttled" });

  // then
  await expect(throttled.last()).toContainText(/Container [0-9a-f]{7} was throttled; \d+ messages dropped/);
});

test("the dropped count is left out under a filter, which it would not be about", async ({ page }) => {
  // given
  const throttled = LogsFlow.rows(page).filter({ hasText: "was throttled" });

  // when
  await page.getByPlaceholder("Type to filter").fill("burst");
  await page.getByRole("button", { name: "Apply", exact: true }).click();

  // then
  await expect(page).toHaveURL(/[?&]pattern=burst/);
  await expect(throttled.last()).toContainText(/Container [0-9a-f]{7} was throttled$/);
  await expect(throttled.last()).not.toContainText("messages dropped");
});
