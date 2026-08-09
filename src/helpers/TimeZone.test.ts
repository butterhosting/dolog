import { describe, expect, it } from "bun:test";
import { TimeZone } from "./TimeZone";

describe(TimeZone.name, () => {
  describe("valid", () => {
    // one per shape rather than per city: the check is a passthrough to `Intl`, and a fifth
    // continent proves nothing a fourth did not
    it.each([
      "UTC", //
      "America/New_York",
      "Europe/Amsterdam",
      "Asia/Kolkata",
      "Australia/Sydney",
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
