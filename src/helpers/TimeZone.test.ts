import { describe, expect, it } from "bun:test";
import { TimeZone } from "./TimeZone";

describe(TimeZone.name, () => {
  describe("valid", () => {
    it.each([
      "UTC",
      "America/New_York",
      "America/Los_Angeles",
      "America/Chicago",
      "America/Sao_Paulo",
      "Europe/London",
      "Europe/Amsterdam",
      "Europe/Berlin",
      "Europe/Moscow",
      "Asia/Tokyo",
      "Asia/Shanghai",
      "Asia/Kolkata",
      "Asia/Dubai",
      "Australia/Sydney",
      "Pacific/Auckland",
      "Africa/Cairo",
    ])("%s", (timezone) => {
      // when
      const result = TimeZone.check(timezone);
      // then
      expect(result).toEqual(true);
    });
  });

  describe("invalid", () => {
    it.each([
      "", //
      "nonsense",
      "America",
      "New_York/America",
      "GMT+1",
      "America/ New_York",
      "Europe/Londn",
    ])("invalid: %s", (timezone) => {
      // when
      const result = TimeZone.check(timezone);
      // then
      expect(result).toEqual(false);
    });
  });
});
