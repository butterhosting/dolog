import { expect, Page, test } from "@playwright/test";
import { AppBoundary } from "./boundaries/AppBoundary";
import { DockerBoundary } from "./boundaries/DockerBoundary";
import { LogsFlow } from "./flows/LogsFlow";

test("a pinned line is still in view after a reload, when the whole log fits in one page", async ({ page }) => {
  // given
  test.setTimeout(30_000);
  const name = `e2e-shortlog-${Date.now()}`;

  try {
    await Internal.openQuietLog(page, { name, lines: 60 });
    const eventId = (await LogsFlow.rows(page).nth(10).getAttribute("data-event"))!;
    const pinned = LogsFlow.row(page, eventId);

    // when
    await pinned.getByTitle("mark this line").click();
    await expect(page).toHaveURL(new RegExp(`[?&]at=${eventId}`));
    await page.reload();

    // then
    await expect(pinned).toHaveAttribute("data-anchored", "true");
    await expect(pinned).toBeInViewport();
  } finally {
    await DockerBoundary.remove(name);
  }
});

test("clearing a filter that left less than a page goes back to the newest line", async ({ page }) => {
  // given
  test.setTimeout(30_000);
  const name = `e2e-shortlog-${Date.now()}`;
  const field = page.getByPlaceholder("Type to filter");
  const apply = page.getByRole("button", { name: "Apply", exact: true });

  try {
    // more than a page, of which 36 lines hold a 5; a dozen matches do not set it off, a score or more do
    await Internal.openQuietLog(page, { name, lines: 180 });
    await field.fill("5");
    await apply.click();
    await expect(page).toHaveURL(/[?&]pattern=5/);
    await expect(LogsFlow.rows(page)).toHaveCount(36);

    // when
    await field.fill("");
    await apply.click();

    // then
    await expect(page).not.toHaveURL(/[?&]pattern=/);
    await expect(LogsFlow.rows(page).last()).toBeInViewport();
    await expect(LogsFlow.jumpToLiveButton(page)).not.toBeVisible();
  } finally {
    await DockerBoundary.remove(name);
  }
});

namespace Internal {
  type OpenQuietLog = {
    name: string;
    lines: number;
  };
  export async function openQuietLog(page: Page, { name, lines }: OpenQuietLog): Promise<void> {
    await DockerBoundary.runQuietly({ name, lines });
    const svc = await AppBoundary.getSvc(page, name);
    // more than `lines` events, because the container's start is one as well
    await AppBoundary.ensureEnoughHistory(page, { svcId: svc.id, events: lines, timeout: 10_000 });
    await page.goto(`services/${svc.id}/logs`);
    await expect(LogsFlow.rows(page).last()).toContainText(`${lines}`);
  }
}
