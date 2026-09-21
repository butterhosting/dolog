import { expect, Locator, Page, test } from "@playwright/test";
import { AppBoundary } from "../boundaries/AppBoundary";

export namespace LogsFlow {
  /**
   * Two pages of history before anything else. These flows are about a log longer than the viewer loads
   * at once, and a stack that only just came up does not have one yet; trickle gets there in ~40 seconds.
   * What the viewer does with less than a page is `03f.logs.shortlog.test.ts`.
   */
  export async function open(page: Page, dname: string): Promise<void> {
    test.setTimeout(60_000);
    const svc = await AppBoundary.getSvc(page, dname);
    await AppBoundary.ensureEnoughHistory(page, { svcId: svc.id, events: 200, timeout: 45_000 });
    await page.goto(`services/${svc.id}/logs`);
    await expect(rows(page).first()).toBeVisible();
  }

  export function rows(page: Page): Locator {
    return page.locator("[data-event]");
  }

  export function row(page: Page, eventId: string): Locator {
    return page.locator(`[data-event="${eventId}"]`);
  }

  export function jumpToLiveButton(page: Page): Locator {
    return page.getByTitle("new lines are not being added while you read back");
  }

  async function newestEventId(page: Page): Promise<string> {
    return (await rows(page).last().getAttribute("data-event"))!;
  }

  export async function expectLive(page: Page): Promise<void> {
    await expect(jumpToLiveButton(page)).not.toBeVisible();
    const before = await newestEventId(page);
    await expect.poll(() => newestEventId(page)).not.toBe(before);
  }

  export async function expectPaused(page: Page): Promise<void> {
    await expect(jumpToLiveButton(page)).toBeVisible();
    const before = await newestEventId(page);
    // trickle writes five lines a second, so a second of nothing is a pause and not a lull
    await page.waitForTimeout(1_000);
    expect(await newestEventId(page)).toBe(before);
  }

  export async function scrollUp(page: Page): Promise<void> {
    await rows(page).last().hover();
    await page.mouse.wheel(0, -1_500);
    await expect(jumpToLiveButton(page)).toBeVisible();
  }

  /** The text of every event row on screen, read in one go so the live stream cannot move between reads. */
  export async function snapshot(page: Page): Promise<Array<{ text: string; match: string | null }>> {
    return await rows(page).evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.textContent ?? "",
        match: element.getAttribute("data-match"),
      })),
    );
  }
}
