import { expect, test } from "@playwright/test";

test("the main page loads and has the right title", async ({ page }) => {
  // when
  await page.goto("");
  // then
  await expect(page).toHaveTitle("Containers | Dolog");
});

test("an unknown route redirects to the containers page", async ({ page }) => {
  // when
  await page.goto("does-not-exist");
  // then
  await expect(page).toHaveURL(/\/containers$/);
});

test("the server pushes a heartbeat over the websocket", async ({ page }) => {
  // given
  const heartbeats: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("heartbeat")) {
      heartbeats.push(message.text());
    }
  });

  // when
  await page.goto("");
  // then (one per second, so two within ~3s)
  await expect.poll(() => heartbeats.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
});

test("the throughput endpoint is available", async ({ page }) => {
  // when
  const response = await page.request.get("/internal-api/containers/throughput");
  // then
  expect(response.status()).toEqual(200);
  expect(await response.json()).toBeInstanceOf(Array);
});

test("the health endpoint is available", async ({ page }) => {
  // when
  const response = await page.request.get("/health");
  // then
  expect(response.status()).toEqual(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
