import { expect, test } from "@playwright/test";
import { LogsFlow } from "./flows/LogsFlow";

test.beforeEach(async ({ page }) => {
  await LogsFlow.open(page, "trickle");
});

test("the header names the group, the container and its image", async ({ page }) => {
  // when
  const header = page.locator("header");

  // then
  await expect(header).toContainText("dolog / trickle");
  await expect(header).toContainText("alpine:latest");
});

test("the toolbar shows the container's cpu and memory", async ({ page }) => {
  await expect(page.getByText(/CPU \d+\.\d%/)).toBeVisible();
  await expect(page.getByText(/[\d.]+ \/ [\d.]+ cores/)).toBeVisible();
  await expect(page.getByText(/MEM \d+\.\d%/)).toBeVisible();
  await expect(page.getByText(/[\d.]+ [KMGT]?i?B \/ [\d.]+ [KMGT]?i?B/)).toBeVisible();
});

test("the text size can be changed, and is remembered", async ({ page }) => {
  // given
  const fontSize = () => LogsFlow.rows(page).first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  const sizes: number[] = [];

  // M is the default, so going S, M, L changes the size at every step
  for (const title of ["S text", "M text", "L text"]) {
    // when
    const before = await fontSize();
    await page.getByTitle(title, { exact: true }).click();
    // then
    await expect.poll(fontSize).not.toBe(before);
    const chosen = await fontSize();

    // when
    await page.reload();
    await expect(LogsFlow.rows(page).first()).toBeVisible();
    // then
    expect(await fontSize()).toBe(chosen);
    sizes.push(chosen);
  }

  // then
  const [s, m, l] = sizes as [number, number, number];
  expect(s).toBeLessThan(m);
  expect(m).toBeLessThan(l);
});
