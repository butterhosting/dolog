import { expect, Page, test } from "@playwright/test";
import { LogsFlow } from "./flows/LogsFlow";

test.beforeEach(async ({ page }) => {
  await LogsFlow.open(page, "trickle");
});

test("the period can be changed, and the url follows it", async ({ page }) => {
  // given
  type TestCase = {
    from: string;
    to: string;
    expectation: {
      url: RegExp;
    };
  };
  const testCases: TestCase[] = [
    { from: "Last 30d", to: "Last 5m", expectation: { url: /[?&]range=preset&rangePreset=last5m/ } },
    { from: "Last 5m", to: "Today", expectation: { url: /[?&]range=preset&rangePreset=today/ } },
    { from: "Today", to: "Last 30d", expectation: { url: /[?&]range=preset&rangePreset=last30d/ } },
  ];

  for (const { from, to, expectation } of testCases) {
    // when
    await Internal.choosePeriod(page, { from, to });

    // then
    await expect(page).toHaveURL(expectation.url);
    await expect(page.locator("header").getByRole("button", { name: to, exact: true })).toBeVisible();
    await expect(LogsFlow.rows(page).first()).toBeVisible();
  }
});

test("filtering only leaves the lines that match, until the filter is cleared", async ({ page }) => {
  // given
  const pattern = "health";
  const field = page.getByPlaceholder("Type to filter");
  const apply = page.getByRole("button", { name: "Apply", exact: true });

  // when
  await field.fill(pattern);
  await apply.click();

  // then
  await expect(page).toHaveURL(/[?&]pattern=health/);
  await expect(async () => {
    const lines = await LogsFlow.snapshot(page);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((line) => !line.text.includes(pattern))).toEqual([]);
  }).toPass();
  await LogsFlow.expectLive(page);

  // when
  await field.fill("");
  await apply.click();

  // then
  await expect(page).not.toHaveURL(/[?&]pattern=/);
  await expect(async () => {
    const lines = await LogsFlow.snapshot(page);
    expect(lines.some((line) => !line.text.includes(pattern))).toBe(true);
  }).toPass();
  await LogsFlow.expectLive(page);
});

namespace Internal {
  type ChoosePeriod = {
    from: string;
    to: string;
  };
  export async function choosePeriod(page: Page, { from, to }: ChoosePeriod): Promise<void> {
    await page.locator("header").getByRole("button", { name: from, exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: to, exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
}
