import { expect, test } from "@playwright/test";
import { WebhooksBoundary } from "./boundaries/WebhooksBoundary";

/**
 * Both alerts go out within seconds of the stack coming up, and then not again for the cooldown. So this
 * asks what has arrived since `webhooks` started rather than waiting for a delivery of its own.
 */
test("a text alert and a throughput alert are delivered to the webhook", async ({ page }) => {
  await expect(async () => {
    // when
    const alerts = await WebhooksBoundary.received(page);

    // then
    const text = alerts.find((alert) => alert.type === "text");
    expect(text).toMatchObject({ object: "alert", svc: { dname: "trickle" }, match: { pattern: '" 500 ' } });
    expect(text!.match!.line).toContain('" 500 ');

    const throughput = alerts.find((alert) => alert.type === "throughput");
    expect(throughput).toMatchObject({ object: "alert", svc: { dname: "firehose" }, breach: { threshold: 300 } });
    expect(throughput!.breach!.logsPerSecond).toBeGreaterThan(300);
  }).toPass();
});
