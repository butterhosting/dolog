import { LogPattern } from "@/models/LogPattern";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "bun:test";
import { LogRange } from "../models/LogRange";
import { useLogFilter } from "./useLogFilter";

/**
 * `toRequest` is the one part of the filter that crosses a boundary, so it is the one part worth
 * pinning down from outside. Everything else the hook does to a filter is private to it.
 */
describe("useLogFilter", () => {
  function applied(overrides: Partial<useLogFilter.ClientFilter> = {}): useLogFilter.ClientFilter {
    return {
      pattern: "",
      patternVariant: LogPattern.Variant.substr,
      range: { kind: "preset", id: "last30d" } satisfies LogRange.Value,
      ...overrides,
    };
  }

  describe("toRequest", () => {
    it("drops an empty pattern rather than sending one that matches everything", () => {
      // when
      const request = useLogFilter.serialize(applied());
      // then
      expect(request.filterPattern).toBeUndefined();
    });

    it("sends no variant without a pattern for it to read", () => {
      // when
      const request = useLogFilter.serialize(applied({ patternVariant: LogPattern.Variant.regex }));
      // then -- a lone variant would look like a filter to the server
      expect(request.filterPattern).toBeUndefined();
      expect(request.filterPatternVariant).toBeUndefined();
    });

    it("sends the variant once there is a pattern", () => {
      // when
      const request = useLogFilter.serialize(applied({ pattern: "boom", patternVariant: LogPattern.Variant.regex }));
      // then
      expect(request.filterPattern).toEqual("boom");
      expect(request.filterPatternVariant).toEqual(LogPattern.Variant.regex);
    });

    it("resolves a relative span into instants", () => {
      // when
      const request = useLogFilter.serialize(applied({ range: { kind: "preset", id: "last1h" } }));
      // then -- an open end, because "the last hour" has no future edge
      expect(Temporal.Instant.from(request.filterSince!)).toBeInstanceOf(Temporal.Instant);
      expect(request.filterUntil).toBeUndefined();
    });

    it("resolves against the clock now, so a relative span keeps sliding", () => {
      // given
      const value = applied({ range: { kind: "preset", id: "last10m" } });
      const before = useLogFilter.serialize(value);
      // when (the same applied filter, asked again a moment later)
      const after = useLogFilter.serialize(value);
      // then
      expect(Temporal.Instant.compare(after.filterSince!, before.filterSince!)).toBeGreaterThanOrEqual(0);
    });

    it("closes both ends for the one preset that has a past", () => {
      // when
      const request = useLogFilter.serialize(applied({ range: { kind: "preset", id: "yesterday" } }));
      // then -- both ends present, and sent as the strings a query string can actually carry
      expect(Temporal.Instant.from(request.filterSince!)).toBeInstanceOf(Temporal.Instant);
      expect(Temporal.Instant.from(request.filterUntil!)).toBeInstanceOf(Temporal.Instant);
    });

    it("passes a custom span through as chosen", () => {
      // given
      const since = Temporal.Instant.from("2026-03-01T00:00:00Z");
      const until = Temporal.Instant.from("2026-03-02T00:00:00Z");
      // when
      const request = useLogFilter.serialize(applied({ range: { kind: "custom", since, until } }));
      // then
      expect(request.filterSince?.toString()).toEqual(since.toString());
      expect(request.filterUntil?.toString()).toEqual(until.toString());
    });
  });
});
