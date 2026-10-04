import { describe, expect, it } from "bun:test";
import { Severity } from "./Severity";

describe("Severity", () => {
  describe("guess", () => {
    it.each([
      ["[2026-10-04 15:05:05,376] [INFO] [paperless.classifier] No updates since last training", Severity.info],
      ["ERROR: relation does not exist", Severity.error],
      ["2026-10-04T13:05:05Z WRN slow query", Severity.warn],
      ["E0806 14:55:55.980915       1 fsHandler.go:121] failed to collect", Severity.error],
      ["[09:58:00 ERR] [MalwareBlocker] Error creating", Severity.error],
      ["[D] cache miss", Severity.debug],
      ["Zigbee2MQTT:info  2026-10-04 MQTT publish", Severity.info],
      ['ts=1 LL="WARN" msg=x', Severity.warn],
      ["handler error: connection reset", Severity.error],
      ["123 FATAL out of memory", Severity.fatal],
      ["\x1b[32mINFO\x1b[0m listening on :8080", Severity.info],
    ])("reads %j as %s", (line, level) => {
      expect(Severity.guess(line)).toBe(level);
    });

    it("lets a level at the front outrank a level word in the message", () => {
      expect(Severity.guess("INFO retrying after error: timeout")).toBe(Severity.info);
    });

    it("leaves a line unmarked when one tier names two levels", () => {
      expect(Severity.guess("[INFO] [ERROR] which is it")).toBeUndefined();
    });

    it("leaves prose unmarked", () => {
      expect(Severity.guess('GET /api/orders 200 3ms')).toBeUndefined();
      expect(Severity.guess("an error occurred")).toBeUndefined();
    });

    it("reads the level key of a json line, pino's numbers included", () => {
      expect(Severity.guess('{"level":"warning","msg":"disk"}')).toBe(Severity.warn);
      expect(Severity.guess('{"level":50,"msg":"boom"}')).toBe(Severity.error);
      expect(Severity.guess('{"severity":"DEBUG","message":"x"}')).toBe(Severity.debug);
    });

    it("trusts a json level key over the words in the message", () => {
      expect(Severity.guess('{"level":"info","msg":"ERROR in upstream, recovered"}')).toBe(Severity.info);
      expect(Severity.guess('{"level":35,"msg":"[ERROR] nope"}')).toBeUndefined();
    });

    it("reads a logfmt level", () => {
      expect(Severity.guess('time=2026-10-04T13:05:05Z level=WARN msg="slow"')).toBe(Severity.warn);
      expect(Severity.guess("lvl=dbug msg=tick")).toBe(Severity.debug);
    });
  });
});
