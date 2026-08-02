import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Logger } from "./Logger";
import { LogLevel } from "./models/internal/LogLevel";

describe(Logger.name, () => {
  let log: Logger;

  beforeEach(async () => {
    await TestEnvironment.initialize();
    log = new Logger("SomeFile.ts");
  });

  describe("lazy arguments", () => {
    it("should not call the producer when the level is disabled", () => {
      // given (the test environment logs at `warn`, so debug is off)
      const produce = mock(() => "expensive");
      // when
      log.debug(produce);
      // then
      expect(produce).not.toHaveBeenCalled();
    });

    it("should call the producer and log its result when the level is enabled", () => {
      // given
      const written = spyOn(console, LogLevel.warn).mockImplementation(() => {});
      const produce = mock(() => "expensive");
      // when
      log.warn(produce);
      // then
      expect(produce).toHaveBeenCalledTimes(1);
      expect(written.mock.calls.at(0)?.at(1)).toEqual("expensive");
    });

    it("should spread a produced array across the log arguments", () => {
      // given
      const written = spyOn(console, LogLevel.warn).mockImplementation(() => {});
      // when
      log.warn(() => ["parsed", 42]);
      // then
      expect(written.mock.calls.at(0)?.slice(1)).toEqual(["parsed", 42]);
    });

    it("should log a function normally when it is not the only argument", () => {
      // given (otherwise `log.warn("the handler is", fn)` would silently call it)
      const written = spyOn(console, LogLevel.warn).mockImplementation(() => {});
      const handler = mock(() => "never called");
      // when
      log.warn("the handler is", handler);
      // then
      expect(handler).not.toHaveBeenCalled();
      expect(written.mock.calls.at(0)?.slice(1)).toEqual(["the handler is", handler]);
    });
  });
});
