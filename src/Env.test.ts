import { LogLevel } from "@/models/internal/LogLevel";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { beforeEach, describe, expect, it } from "bun:test";
import { Env } from "./Env";

describe("Env", () => {
  const REQUIRED = { DOLOG_STAGE: "dev", DOLOG_ROOT: "/opt/dolog" };

  beforeEach(async () => {
    await TestEnvironment.initialize();
  });

  it("should fall back to a default for what is unset or empty, and remember what was provided", () => {
    // given (an env file expands an unset variable to nothing, so empty counts as unset)
    const env = Env.initialize("UTC", { ...REQUIRED, DOLOG_LOGGING: "debug", DOLOG_RETENTION_TIME_WINDOW: "" });
    // then
    expect(env.DOLOG_LOGGING).toEqual(LogLevel.debug);
    expect(env.DOLOG_RETENTION_TIME_WINDOW.toString()).toEqual("P180D");
    expect(env.DOLOG_THROTTLING_LOGS_PER_SECOND).toEqual(100);
    expect(env.DOLOG_PROVIDED).toEqual({ DOLOG_LOGGING: "debug" });
  });

  it("should read the webhooks as name=url entries split on any whitespace, moving credentials out of the URL", () => {
    // given (a newline between entries, as a compose block scalar would write it)
    const env = Env.initialize("UTC", {
      ...REQUIRED,
      DOLOG_WEBHOOKS: "ops=https://alerts:s3cret@hooks.example.com/dolog?tags=a,b\n  on-call=http://ntfy.local/dolog ",
      DOLOG_ALERTING_WEBHOOK_REF: "on-call",
    });
    // then
    expect(env.DOLOG_WEBHOOKS).toEqual({
      ops: { url: "https://hooks.example.com/dolog?tags=a,b", auth: { username: "alerts", password: "s3cret" } },
      "on-call": { url: "http://ntfy.local/dolog", auth: undefined },
    });
    expect(env.DOLOG_ALERTING_WEBHOOK_REF).toEqual("on-call");
    expect(Env.initialize("UTC", REQUIRED).DOLOG_WEBHOOKS).toEqual({});
  });

  it("should refuse a webhook with a bad name or URL, but take an alert target's name as written", () => {
    expect(() => Env.initialize("UTC", { ...REQUIRED, DOLOG_WEBHOOKS: "op.s=https://x" })).toThrow("invalid_webhook_name");
    expect(() => Env.initialize("UTC", { ...REQUIRED, DOLOG_WEBHOOKS: "https://x" })).toThrow("invalid_webhook_name");
    expect(Object.keys(Env.initialize("UTC", { ...REQUIRED, DOLOG_WEBHOOKS: "App_Alerts-2=https://x" }).DOLOG_WEBHOOKS)).toEqual(["App_Alerts-2"]);
    expect(() => Env.initialize("UTC", { ...REQUIRED, DOLOG_WEBHOOKS: "ops=notaurl" })).toThrow("invalid_webhook_url");
    expect(() => Env.initialize("UTC", { ...REQUIRED, DOLOG_WEBHOOKS: "ops=ftp://x" })).toThrow("invalid_webhook_url");
    expect(Env.initialize("UTC", { ...REQUIRED, DOLOG_ALERTING_WEBHOOK_REF: "nobody" }).DOLOG_ALERTING_WEBHOOK_REF).toEqual("nobody");
  });

  it("should read an empty alerting setting as off, and a filled one as a value", () => {
    // given
    const off = Env.initialize("UTC", REQUIRED);
    const on = Env.initialize("UTC", { ...REQUIRED, DOLOG_ALERTING_TEXT_PATTERN: "ERROR|FATAL", DOLOG_ALERTING_THROUGHPUT_THRESHOLD: "250" });
    // then
    expect(off.DOLOG_ALERTING_TEXT_PATTERN).toBeUndefined();
    expect(off.DOLOG_ALERTING_THROUGHPUT_THRESHOLD).toBeUndefined();
    expect(off.DOLOG_ALERTING_COOLDOWN_WINDOW.total("minutes")).toEqual(5);
    expect(on.DOLOG_ALERTING_TEXT_PATTERN?.test("a FATAL thing")).toEqual(true);
    expect(on.DOLOG_ALERTING_THROUGHPUT_THRESHOLD).toEqual(250);
    expect(() => Env.initialize("UTC", { ...REQUIRED, DOLOG_ALERTING_TEXT_PATTERN: "(" })).toThrow("invalid_regex");
  });

});
