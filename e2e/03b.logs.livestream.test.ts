import { expect, test } from "@playwright/test";
import { LogsFlow } from "./flows/LogsFlow";

test.beforeEach(async ({ page }) => {
  await LogsFlow.open(page, "trickle");
});

test("new lines are appended as they are logged", async ({ page }) => {
  await LogsFlow.expectLive(page);
});

test("scrolling up pauses the stream until the jump-to-live button is clicked", async ({ page }) => {
  // when
  await LogsFlow.scrollUp(page);
  // then
  await LogsFlow.expectPaused(page);

  // when
  await LogsFlow.jumpToLiveButton(page).click();
  // then
  await LogsFlow.expectLive(page);
});

test("a clicked line stays pinned across a reload, until it is clicked again", async ({ page }) => {
  // given
  await LogsFlow.scrollUp(page);
  const eventId = (await LogsFlow.rows(page).nth(40).getAttribute("data-event"))!;
  const pinned = LogsFlow.row(page, eventId);

  // when
  await pinned.getByTitle("mark this line").click();
  // then
  await expect(pinned).toHaveAttribute("data-anchored", "true");
  await expect(page).toHaveURL(new RegExp(`[?&]at=${eventId}`));

  // when
  await page.reload();
  // then
  await expect(pinned).toHaveAttribute("data-anchored", "true");
  await expect(pinned).toBeInViewport();
  await LogsFlow.expectPaused(page);

  // when
  await pinned.getByTitle("mark this line").click();
  // then
  await expect(pinned).not.toHaveAttribute("data-anchored", "true");
  await expect(page).not.toHaveURL(/[?&]at=/);

  // when
  await page.reload();
  // then
  await LogsFlow.expectLive(page);
});
