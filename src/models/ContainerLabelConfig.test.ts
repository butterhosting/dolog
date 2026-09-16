import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it } from "bun:test";
import { ContainerLabelConfig } from "./ContainerLabelConfig";

describe("ContainerLabelConfig", () => {
  let context: TestEnvironment.Context;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
  });

  it("should fall back to the env for every setting a container does not label", () => {
    // given (the test env: 5 logs per second, 30d, 100000 lines)
    // when
    const { config, sources, issues } = ContainerLabelConfig.resolve(context.env, {});
    // then
    expect(config.throttlingLogsPerSecond).toEqual(5);
    expect(config.retentionTimeWindow.toString()).toEqual("P30D");
    expect(config.retentionMaxLines).toEqual(100_000);
    expect(sources).toEqual({ throttlingLogsPerSecond: "env", retentionTimeWindow: "env", retentionMaxLines: "env" });
    expect(issues).toEqual([]);
  });

  it("should let a label override its env default, and only its own", () => {
    // given
    const dlabels = { "throttling.logs-per-second": "50", "retention.time-window": "12h" };
    // when
    const { config, sources } = ContainerLabelConfig.resolve(context.env, dlabels);
    // then
    expect(config.throttlingLogsPerSecond).toEqual(50);
    expect(Temporal.Duration.compare(config.retentionTimeWindow, { hours: 12 })).toEqual(0);
    expect(config.retentionMaxLines).toEqual(100_000);
    expect(sources).toEqual({ throttlingLogsPerSecond: "label", retentionTimeWindow: "label", retentionMaxLines: "env" });
  });

  it("should report a label it cannot read, and use the env default in its place", () => {
    // given
    const dlabels = { "retention.max-lines": "lots", "throttling.logs-per-second": "0" };
    // when
    const { config, sources, issues } = ContainerLabelConfig.resolve(context.env, dlabels);
    // then
    expect(config.retentionMaxLines).toEqual(100_000);
    expect(config.throttlingLogsPerSecond).toEqual(5);
    expect(sources.retentionMaxLines).toEqual("env");
    expect(issues).toEqual([
      { label: "dolog.throttling.logs-per-second", value: "0", reason: "invalid_positive_integer" },
      { label: "dolog.retention.max-lines", value: "lots", reason: "invalid_positive_integer" },
    ]);
  });

  it("should read a duration as a whole number of seconds, minutes, hours or days", () => {
    // given
    const window = (value: string) =>
      ContainerLabelConfig.resolve(context.env, { "retention.time-window": value }).config.retentionTimeWindow;
    // then
    expect(window("90s").total("seconds")).toEqual(90);
    expect(window("30m").total("minutes")).toEqual(30);
    expect(window("24h").total("hours")).toEqual(24);
    expect(window("2d").total("days")).toEqual(2);
  });

  it("should refuse a duration it cannot total, and say so", () => {
    // given (ISO-8601 and months are not accepted; neither has a fixed length in every unit)
    const dlabels = { "retention.time-window": "P30D" };
    // when
    const { config, issues } = ContainerLabelConfig.resolve(context.env, dlabels);
    // then
    expect(config.retentionTimeWindow.toString()).toEqual("P30D");
    expect(issues).toEqual([{ label: "dolog.retention.time-window", value: "P30D", reason: "invalid_duration" }]);
  });

  it("should spell a setting's env var as its name upper-cased with underscores", () => {
    expect(ContainerLabelConfig.envKeyOf("retention.time-window")).toEqual("X_DOLOG_RETENTION_TIME_WINDOW");
    expect(ContainerLabelConfig.envKeyOf("throttling.logs-per-second")).toEqual("X_DOLOG_THROTTLING_LOGS_PER_SECOND");
  });
});
