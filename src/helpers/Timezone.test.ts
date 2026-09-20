import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "bun:test";
import { Timezone } from "./Timezone";

describe("Timezone", () => {
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
      const result = Timezone.check(timezone);
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
      const result = Timezone.check(timezone);
      // then
      expect(result).toEqual(false);
    });
  });

  // Kathmandu is +05:45, so a conversion that is skipped, or that only moves the hour, shows up
  describe("wall clock", () => {
    const KATHMANDU = "Asia/Kathmandu";
    const AMSTERDAM = "Europe/Amsterdam";

    it("shows an instant on the zone's clock", () => {
      // when
      const wallClock = Timezone.toWallClock(Temporal.Instant.from("2026-03-01T20:30:00Z"), KATHMANDU);
      // then -- across midnight, so the date moves too
      expect(wallClock.toString()).toEqual("2026-03-02T02:15:00");
      expect(Timezone.dayOf(Temporal.Instant.from("2026-03-01T20:30:00Z"), KATHMANDU).toString()).toEqual("2026-03-02");
    });

    it.each([
      ["2026-03-02T02:15:00", "2026-03-01T20:30:00Z"],
      ["2026-03-02T02:15", "2026-03-01T20:30:00Z"], // what `datetime-local` sends without seconds
    ])("reads %s back into the instant", (typed, expected) => {
      // when
      const instant = Timezone.fromWallClock(typed, KATHMANDU);
      // then
      expect(instant?.toString()).toEqual(expected);
    });

    it.each(["", "nonsense", "2026-03-02T25:00", "2026-03-02T02:15:00Z"])("refuses %s", (typed) => {
      // when
      const instant = Timezone.fromWallClock(typed, KATHMANDU);
      // then
      expect(instant).toBeNull();
    });

    it("springs a skipped clock forward, and reads a repeated one as the first", () => {
      // when
      const skipped = Timezone.fromWallClock("2026-03-29T02:30", AMSTERDAM);
      const repeated = Timezone.fromWallClock("2026-10-25T02:30", AMSTERDAM);
      // then
      expect(skipped?.toString()).toEqual("2026-03-29T01:30:00Z");
      expect(repeated?.toString()).toEqual("2026-10-25T00:30:00Z");
    });

    it("finds midnight on a day that is not 24 hours long", () => {
      // given
      const day = Temporal.PlainDate.from("2026-10-25");
      // when
      const hours = Timezone.midnight(day, AMSTERDAM).until(Timezone.midnight(day.add({ days: 1 }), AMSTERDAM)).total("hours");
      // then
      expect(hours).toEqual(25);
    });
  });
});
