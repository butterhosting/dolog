import { expect, test } from "@playwright/test";
import { LogsFlow } from "./flows/LogsFlow";

test.beforeEach(async ({ page }) => {
  await LogsFlow.open(page, "trickle");
});

/**
 * database gets cleared beforehand -> nothing could have been logged yesterday -> yesterday lands on the first line
 */
test("navigating to yesterday lands at the beginning, and stays there until the marker is dismissed", async ({ page }) => {
  // given
  const marker = page.getByTitle("dismiss this marker");
  const beginning = page.getByText("this is the beginning");

  // when
  await page.getByRole("button", { name: /^Navigate/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Yesterday", exact: true }).click();
  await dialog.getByRole("button", { name: "Jump", exact: true }).click();

  // then
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/[?&]at=/);
  await expect(beginning).toBeInViewport();
  await expect(marker).toBeInViewport();
  await LogsFlow.expectPaused(page);

  // when
  await page.reload();
  // then
  await expect(beginning).toBeInViewport();
  await expect(marker).toBeInViewport();
  await LogsFlow.expectPaused(page);

  // when
  await marker.click();
  // then
  await expect(marker).not.toBeVisible();
  await expect(page).not.toHaveURL(/[?&]at=/);

  // when
  await page.reload();
  // then
  await expect(beginning).not.toBeVisible();
  await LogsFlow.expectLive(page);
});
