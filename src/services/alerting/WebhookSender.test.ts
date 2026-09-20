import { Alert } from "@/models/Alert";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Yexception } from "yexception";
import { WebhookSender } from "./WebhookSender";

describe(WebhookSender.name, () => {
  let context: TestEnvironment.Context;
  let sender: WebhookSender;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    sender = new WebhookSender();
  });

  it("should post the alert as JSON, with the webhook's credentials in a header", async () => {
    // given (the test env's `ops` webhook carries `alerts:secret`)
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const alert = TestFixture.textAlert();
    // when
    await sender.post(context.env.DOLOG_WEBHOOKS.ops!, alert);
    // then
    const [url, init] = fetch.mock.calls[0]!;
    const headers = new Headers(init!.headers);
    expect(url).toEqual("https://hooks.example.com/dolog");
    expect(init!.method).toEqual("POST");
    expect(headers.get("Content-Type")).toEqual("application/json");
    expect(headers.get("Authorization")).toEqual(`Basic ${btoa("alerts:secret")}`);
    expect(Alert.parse(JSON.parse(init!.body as string))).toEqual(alert);
  });

  it("should send no credentials for a webhook without any", async () => {
    // given
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    // when
    await sender.post({ url: "http://ntfy.local/dolog" }, TestFixture.throughputAlert());
    // then
    expect(new Headers(fetch.mock.calls[0]![1]!.headers).has("Authorization")).toBeFalse();
  });

  it("should turn a refusal into a domain error", async () => {
    // given
    spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    // then
    expect(sender.post({ url: "http://ntfy.local/dolog" }, TestFixture.textAlert())).rejects.toEqual(
      expect.objectContaining({
        problem: "AlertError::webhook_refused",
        details: { url: "http://ntfy.local/dolog", status: 401 },
      } satisfies Partial<Yexception>),
    );
  });

  it("should turn an unreachable webhook into a domain error", async () => {
    // given
    spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    // then
    expect(sender.post({ url: "http://ntfy.local/dolog" }, TestFixture.textAlert())).rejects.toEqual(
      expect.objectContaining({ problem: "AlertError::webhook_unreachable" } satisfies Partial<Yexception>),
    );
  });
});
