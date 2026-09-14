import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it } from "bun:test";
import { ContainerConfig } from "./ContainerConfig";

describe("ContainerConfig", () => {
  let context: TestEnvironment.Context;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
  });

  it("should fall back to the env for every setting a container does not label", () => {
    // given (the test env: 5 logs per second, 30d, 100000 lines)
    // when
    const { config, sources, issues } = ContainerConfig.resolve(context.env, {});
    // then
    expect(config.throttleLogsPerSecond).toEqual(5);
    expect(config.retentionTimeWindow.toString()).toEqual("P30D");
    expect(config.retentionMaxLines).toEqual(100_000);
    expect(sources).toEqual({ throttleLogsPerSecond: "env", retentionTimeWindow: "env", retentionMaxLines: "env" });
    expect(issues).toEqual([]);
  });

  it("should let a label override its env default, and only its own", () => {
    // given
    const dlabels = { "throttle.logs-per-second": "50", "retention.time-window": "12h" };
    // when
    const { config, sources } = ContainerConfig.resolve(context.env, dlabels);
    // then
    expect(config.throttleLogsPerSecond).toEqual(50);
    expect(Temporal.Duration.compare(config.retentionTimeWindow, { hours: 12 })).toEqual(0);
    expect(config.retentionMaxLines).toEqual(100_000);
    expect(sources).toEqual({ throttleLogsPerSecond: "label", retentionTimeWindow: "label", retentionMaxLines: "env" });
  });

  it("should report a label it cannot read, and use the env default in its place", () => {
    // given
    const dlabels = { "retention.max-lines": "lots", "throttle.logs-per-second": "0" };
    // when
    const { config, sources, issues } = ContainerConfig.resolve(context.env, dlabels);
    // then
    expect(config.retentionMaxLines).toEqual(100_000);
    expect(config.throttleLogsPerSecond).toEqual(5);
    expect(sources.retentionMaxLines).toEqual("env");
    expect(issues).toEqual([
      { label: "dolog.throttle.logs-per-second", value: "0", reason: "invalid_positive_integer" },
      { label: "dolog.retention.max-lines", value: "lots", reason: "invalid_positive_integer" },
    ]);
  });

  it("should read a duration as a whole number of a fixed unit, with a week being seven days", () => {
    // given
    const window = (value: string) => ContainerConfig.resolve(context.env, { "retention.time-window": value }).config.retentionTimeWindow;
    // then
    expect(window("90s").total("seconds")).toEqual(90);
    expect(window("30m").total("minutes")).toEqual(30);
    expect(window("2w").total("days")).toEqual(14);
  });

  it("should refuse a duration it cannot total, and say so", () => {
    // given (ISO-8601 and months are not accepted; neither has a fixed length in every unit)
    const dlabels = { "retention.time-window": "P30D" };
    // when
    const { config, issues } = ContainerConfig.resolve(context.env, dlabels);
    // then
    expect(config.retentionTimeWindow.toString()).toEqual("P30D");
    expect(issues).toEqual([{ label: "dolog.retention.time-window", value: "P30D", reason: "invalid_duration" }]);
  });

  it("should spell a setting's env var as its name upper-cased with underscores", () => {
    expect(ContainerConfig.envKeyOf("retention.time-window")).toEqual("X_DOLOG_RETENTION_TIME_WINDOW");
    expect(ContainerConfig.envKeyOf("throttle.logs-per-second")).toEqual("X_DOLOG_THROTTLE_LOGS_PER_SECOND");
  });
});
