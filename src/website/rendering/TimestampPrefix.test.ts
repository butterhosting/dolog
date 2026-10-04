import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "bun:test";
import { TimestampPrefix } from "./TimestampPrefix";

describe("TimestampPrefix", () => {
  describe("length", () => {
    const docker = Temporal.Instant.from("2026-10-04T13:05:05.379Z");

    function remainder(line: string, timestamp = docker): string {
      return line.slice(TimestampPrefix.length(line, timestamp));
    }

    it("drops a zoneless local time, brackets included", () => {
      // given -- written in Europe/Amsterdam, two hours ahead of docker's utc
      const line = "[2026-10-04 15:05:05,376] [INFO] No updates since last training";
      // then
      expect(remainder(line)).toBe("[INFO] No updates since last training");
    });

    it.each([
      "2026-10-04T13:05:05Z hello",
      "2026-10-04T13:05:05.123456Z hello",
      "2026-10-04 18:50:05.000+05:45 hello",
      "2026-10-04 08:05:05-0500 hello",
      "2026/10/04 13:05:04 hello",
      "[2026-10-04T13:05:05Z]hello",
    ])("drops %j", (line) => {
      expect(remainder(line)).toBe("hello");
    });

    it("keeps a zoned time that disagrees with docker's", () => {
      expect(remainder("2026-10-04T15:05:05Z hello")).toBe("2026-10-04T15:05:05Z hello");
    });

    it("keeps a zoneless time that is not a whole quarter hour off", () => {
      expect(remainder("2026-10-04 13:12:05 hello")).toBe("2026-10-04 13:12:05 hello");
    });

    it("keeps a time that is the whole line, or glued to the text", () => {
      expect(remainder("2026-10-04T13:05:05Z")).toBe("2026-10-04T13:05:05Z");
      expect(remainder("2026-10-04T13:05:05Zhello")).toBe("2026-10-04T13:05:05Zhello");
    });

    it("keeps half-bracketed and mixed-separator dates", () => {
      expect(remainder("[2026-10-04T13:05:05Z hello")).toBe("[2026-10-04T13:05:05Z hello");
      expect(remainder("2026-10/04 13:05:05 hello")).toBe("2026-10/04 13:05:05 hello");
    });
  });
});
