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

test("the websocket accepts a connection and a watch request", async ({ page }) => {
  // given
  await page.goto("");

  // when (the page opens its own socket, so this drives a second one directly)
  const accepted = await page.evaluate(async () => {
    const socket = new WebSocket(`ws://${location.host}/socket`);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve);
      socket.addEventListener("error", reject);
    });
    socket.send(JSON.stringify({ type: "watch", containerId: "does-not-exist" }));
    // still open a moment later, so the server did not choke on the message
    await new Promise((resolve) => setTimeout(resolve, 250));
    const open = socket.readyState === WebSocket.OPEN;
    socket.close();
    return open;
  });

  // then
  expect(accepted).toBe(true);
});

test("the container endpoints are available", async ({ page }) => {
  // then
  const overview = await page.request.get("/internal-api/containers");
  expect(overview.status()).toEqual(200);
  expect(await overview.json()).toBeInstanceOf(Array);

  const throughput = await page.request.get("/internal-api/containers/throughput");
  expect(throughput.status()).toEqual(200);
  expect(await throughput.json()).toBeInstanceOf(Array);

  // an unknown container has no history rather than an error
  const events = await page.request.get("/internal-api/containers/does-not-exist/events");
  expect(events.status()).toEqual(200);
  expect(await events.json()).toEqual({ events: [], olderCursor: null });
});

test("the health endpoint is available", async ({ page }) => {
  // when
  const response = await page.request.get("/health");
  // then
  expect(response.status()).toEqual(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
