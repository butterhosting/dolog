import { Pattern } from "@/models/Pattern";
import { Timespan } from "@/website/hooks/objects/Timespan";
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
      timespan: Timespan.forPreset(Timespan.Preset.last30d),
      ...overrides,
    };
  }

  describe("serializeForServer", () => {
    it("drops an absent pattern rather than sending one that matches everything", () => {
      // when
      const request = useFilter.serializeForServer(applied());
      // then
      expect(request.filterPattern).toBeUndefined();
      // and a lone type would look like a filter to the server
      expect(request.filterPatternType).toBeUndefined();
    });

    it("sends the type once there is a pattern to read it", () => {
      // when
      const request = useFilter.serializeForServer(applied({ pattern: { type: Pattern.Type.regex, value: "boom" } }));
      // then
      expect(request.filterPattern).toEqual("boom");
      expect(request.filterPatternType).toEqual(Pattern.Type.regex);
    });

    it("resolves a relative span into instants", () => {
      // when
      const request = useFilter.serializeForServer(applied({ timespan: Timespan.forPreset(Timespan.Preset.last1h) }));
      // then -- an open end, because "the last hour" has no future edge
      expect(Temporal.Instant.from(request.filterSince!)).toBeInstanceOf(Temporal.Instant);
      expect(request.filterUntil).toBeUndefined();
    });

    it("resolves against the clock now, so a relative span keeps sliding", () => {
      // given
      const value = applied({ timespan: Timespan.forPreset(Timespan.Preset.last10m) });
      const before = useFilter.serializeForServer(value);
      // when (the same applied filter, asked again a moment later)
      const after = useFilter.serializeForServer(value);
      // then
      expect(Temporal.Instant.compare(after.filterSince!, before.filterSince!)).toBeGreaterThanOrEqual(0);
    });

    it("closes both ends for the one preset that has a past", () => {
      // when
      const request = useFilter.serializeForServer(applied({ timespan: Timespan.forPreset(Timespan.Preset.yesterday) }));
      // then -- both ends present, and sent as the strings a query string can actually carry
      expect(Temporal.Instant.from(request.filterSince!)).toBeInstanceOf(Temporal.Instant);
      expect(Temporal.Instant.from(request.filterUntil!)).toBeInstanceOf(Temporal.Instant);
    });

    it("leaves both ends open for all time", () => {
      // when
      const request = useFilter.serializeForServer(applied({ timespan: Timespan.forPreset(Timespan.Preset.all) }));
      // then
      expect(request.filterSince).toBeUndefined();
      expect(request.filterUntil).toBeUndefined();
    });

    it("passes a custom span through as chosen", () => {
      // given
      const since = Temporal.Instant.from("2026-03-01T00:00:00Z");
      const until = Temporal.Instant.from("2026-03-02T00:00:00Z");
      // when
      const request = useFilter.serializeForServer(applied({ timespan: Timespan.forCustom({ since, until }) }));
      // then
      expect(request.filterSince?.toString()).toEqual(since.toString());
      expect(request.filterUntil?.toString()).toEqual(until.toString());
    });
  });
});
