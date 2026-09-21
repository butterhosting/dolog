import { expect, test } from "@playwright/test";
import { DockerBoundary } from "./boundaries/DockerBoundary";
import { PreferencesFlow } from "./flows/PreferencesFlow";

// based on `compose-e2e.yaml`
const RUNNING = ["dolog-application-1", "firehose", "trickle", "webhooks"];

test.beforeEach(async ({ page }) => {
  await page.goto("");
});

test("the summary counts the running containers and shows the host's cpu and memory", async ({ page }) => {
  // when
  const summary = page.locator("header");

  // then
  await expect(summary).toContainText(`${RUNNING.length} running`);
  await expect(summary).toContainText(/CPU \d+\.\d%/);
  await expect(summary).toContainText(/[\d.]+ \/ [\d.]+ cores/);
  await expect(summary).toContainText(/MEM \d+\.\d%/);
  await expect(summary).toContainText(/[\d.]+ [KMGT]iB \/ [\d.]+ [KMGT]iB/);
});

test("every running container has a card", async ({ page }) => {
  // when
  const cards = page.getByTestId("svc-card");

  // then
  await expect(cards).toHaveCount(RUNNING.length);
  for (const dname of RUNNING) {
    await expect(cards.filter({ hasText: dname })).toHaveCount(1);
  }
  await expect(cards.filter({ hasText: "stopped" })).toHaveCount(0);
});

test("a card says how fast its container logs, or that it is being throttled", async ({ page }) => {
  // when
  const cards = page.getByTestId("svc-card");

  // then
  // firehose writes ~400 lines a second against a budget of 150; see `compose-deps.yaml`
  await expect(cards.filter({ hasText: "firehose" })).toContainText("throttling");
  await expect(cards.filter({ hasText: "trickle" })).toContainText(/\d+ logs?\/second/);
  await expect(cards.filter({ hasText: "trickle" })).not.toContainText("throttling");
});

test("a stopped container only shows once the preferences ask for it", async ({ page }) => {
  // given
  // a reused stack remembers the containers of earlier runs, so each run brings a name of its own
  const name = `e2e-ephemeral-${Date.now()}`;
  const card = page.getByTestId("svc-card").filter({ hasText: name });

  try {
    await DockerBoundary.runToCompletion({ name, line: "hello from the e2e suite" });
    await page.reload();
    await expect(page.getByTestId("svc-card")).toHaveCount(RUNNING.length);
    await expect(card).toHaveCount(0);

    // when
    await PreferencesFlow.setHideStopped(page, { hideStopped: false });

    // then
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("stopped");

    // when
    await PreferencesFlow.setHideStopped(page, { hideStopped: true });

    // then
    await expect(card).toHaveCount(0);
  } finally {
    await DockerBoundary.remove(name);
  }
});
