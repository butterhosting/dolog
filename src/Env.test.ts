import { LogLevel } from "@/models/internal/LogLevel";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { beforeEach, describe, expect, it } from "bun:test";
import { Env } from "./Env";

describe("Env", () => {
  const REQUIRED = { O_DOLOG_STAGE: "dev", X_DOLOG_ROOT: "/opt/dolog" };

  beforeEach(async () => {
    await TestEnvironment.initialize();
  });

  it("should fall back to a default for what is unset or empty, and remember what was provided", () => {
    // given (an env file expands an unset variable to nothing, so empty counts as unset)
    const env = Env.initialize("UTC", { ...REQUIRED, X_DOLOG_LOGGING: "debug", X_DOLOG_RETENTION_TIME_WINDOW: "" });
    // then
    expect(env.X_DOLOG_LOGGING).toEqual(LogLevel.debug);
    expect(env.X_DOLOG_RETENTION_TIME_WINDOW.toString()).toEqual("P180D");
    expect(env.X_DOLOG_THROTTLING_LOGS_PER_SECOND).toEqual(100);
    expect(env.X_DOLOG_PROVIDED).toEqual({ X_DOLOG_LOGGING: "debug" });
  });

  it("should name a variable the way the operator sets it", () => {
    expect(Env.realEnvName("X_DOLOG_LOGGING")).toEqual("DOLOG_LOGGING");
    expect(Env.realEnvName("O_DOLOG_TIMEZONE")).toEqual("DOLOG_TIMEZONE");
  });
});
