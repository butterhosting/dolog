import { Pattern } from "@/models/Pattern";
import { Range } from "@/website/hooks/objects/Range";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "bun:test";
import { useFilter } from "./useFilter";
import { ClientFilter } from "./objects/ClientFilter";

/**
 * `serializeForServer` is the one part of the filter that crosses a boundary, so it is the one part
 * worth pinning down from outside. Everything else the hook does to a filter is private to it.
 */
describe("useFilter", () => {
  function applied(overrides: Partial<ClientFilter> = {}): ClientFilter {
    return {
      range: Range.forPreset(Range.Preset.last30d),
      ...overrides,
    };
  }

  // +05:45, so a day that was cut at UTC midnight instead cannot pass for the right one
  const KATHMANDU = "Asia/Kathmandu";

  function serialize(filter: ClientFilter) {
    return useFilter.serializeForServer(filter, KATHMANDU);
  }

  describe("serializeForServer", () => {
    it("cuts yesterday at the zone's midnights", () => {
      // given -- 19:00Z is already the 2nd in Kathmandu
      const now = Temporal.Instant.from("2026-03-01T19:00:00Z");
      // when
      const yesterday = Range.forPreset(Range.Preset.yesterday).materialize(KATHMANDU, now);
      const today = Range.forPreset(Range.Preset.today).materialize(KATHMANDU, now);
      // then
      expect(yesterday.since?.toString()).toEqual("2026-02-28T18:15:00Z");
      expect(yesterday.until?.toString()).toEqual("2026-03-01T18:15:00Z");
      expect(today.since?.toString()).toEqual("2026-03-01T18:15:00Z");
      expect(today.until).toBeUndefined();
    });

    it("drops an absent pattern rather than sending one that matches everything", () => {
      // when
      const request = serialize(applied());
      // then
      expect(request.filterPattern).toBeUndefined();
      // and a lone type would look like a filter to the server
      expect(request.filterPatternType).toBeUndefined();
    });

    it("sends the type once there is a pattern to read it", () => {
      // when
      const request = serialize(applied({ pattern: { type: Pattern.Type.regex, value: "boom" } }));
      // then
      expect(request.filterPattern).toEqual("boom");
      expect(request.filterPatternType).toEqual(Pattern.Type.regex);
    });

    it("resolves a relative span into instants", () => {
      // when
      const request = serialize(applied({ range: Range.forPreset(Range.Preset.last1h) }));
      // then -- an open end, because "the last hour" has no future edge
      expect(Temporal.Instant.from(request.filterSince!)).toBeInstanceOf(Temporal.Instant);
      expect(request.filterUntil).toBeUndefined();
    });

    it("resolves against the clock now, so a relative span keeps sliding", () => {
      // given
      const value = applied({ range: Range.forPreset(Range.Preset.last10m) });
      const before = serialize(value);
      // when (the same applied filter, asked again a moment later)
      const after = serialize(value);
      // then
      expect(Temporal.Instant.compare(after.filterSince!, before.filterSince!)).toBeGreaterThanOrEqual(0);
    });

    it("closes both ends for the one preset that has a past", () => {
      // when
      const request = serialize(applied({ range: Range.forPreset(Range.Preset.yesterday) }));
      // then -- both ends present, and sent as the strings a query string can actually carry
      expect(Temporal.Instant.from(request.filterSince!)).toBeInstanceOf(Temporal.Instant);
      expect(Temporal.Instant.from(request.filterUntil!)).toBeInstanceOf(Temporal.Instant);
    });

    it("leaves both ends open for all time", () => {
      // when
      const request = serialize(applied({ range: Range.forPreset(Range.Preset.all) }));
      // then
      expect(request.filterSince).toBeUndefined();
      expect(request.filterUntil).toBeUndefined();
    });

    it("passes a custom span through as chosen", () => {
      // given
      const since = Temporal.Instant.from("2026-03-01T00:00:00Z");
      const until = Temporal.Instant.from("2026-03-02T00:00:00Z");
      // when
      const request = serialize(applied({ range: Range.forCustom({ since, until }) }));
      // then
      expect(request.filterSince?.toString()).toEqual(since.toString());
      expect(request.filterUntil?.toString()).toEqual(until.toString());
    });
  });
});
