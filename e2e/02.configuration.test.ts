import { expect, test } from "@playwright/test";

/**
 * Based on `Env.Defaults`, `.env.e2e` and the labels in `compose-deps.yaml`
 */
test("every setting is listed under its topic, with its value and the labels overriding it", async ({ page }) => {
  // given
  type TestCase = {
    topic: string;
    envVar: string;
    expectation: string[];
  };
  const testCases: TestCase[] = [
    {
      topic: "system",
      envVar: "DOLOG_TIMEZONE",
      expectation: ["UTC (using default)"],
    },
    {
      topic: "system",
      envVar: "DOLOG_LOGGING",
      expectation: ["debug"],
    },
    {
      topic: "retention",
      envVar: "DOLOG_RETENTION_MAX_LINES",
      expectation: ["100000 (using default)", "dolog.retention.max-lines", "(no labels detected)"],
    },
    {
      topic: "throttling",
      envVar: "DOLOG_THROTTLING_LOGS_PER_SECOND",
      expectation: ["100 (using default)", "dolog.throttling.logs-per-second", "dolog / firehose", "150"],
    },
    { topic: "webhooks", envVar: "DOLOG_WEBHOOKS", expectation: ["local = http://webhooks:3001/"] },
    {
      topic: "alerting",
      envVar: "DOLOG_ALERTING_WEBHOOK_REF",
      expectation: ["local", "dolog.alerting.webhook-ref", "(no labels detected)"],
    },
    {
      topic: "alerting",
      envVar: "DOLOG_ALERTING_TEXT_PATTERN",
      expectation: ["(none)", "dolog.alerting.text-pattern", "dolog / trickle", '" 500'],
    },
    {
      topic: "alerting",
      envVar: "DOLOG_ALERTING_THROUGHPUT_THRESHOLD",
      expectation: ["(none)", "dolog.alerting.throughput-threshold", "dolog / firehose", "300"],
    },
  ];

  // when
  await page.goto("configuration");

  // then
  for (const { topic, envVar, expectation } of testCases) {
    const setting = page.getByTestId(`topic-${topic}`).getByTestId(`setting-${envVar}`);
    await expect(setting).toContainText(envVar);
    for (const text of expectation) {
      await expect(setting).toContainText(text);
    }
  }
});

test("a label override links to the logs of the container carrying it", async ({ page }) => {
  // given
  await page.goto("configuration");

  // when
  await page.getByTestId("setting-DOLOG_THROTTLING_LOGS_PER_SECOND").getByRole("link", { name: "dolog / firehose" }).click();

  // then
  await expect(page).toHaveTitle("firehose | Dolog");
});
