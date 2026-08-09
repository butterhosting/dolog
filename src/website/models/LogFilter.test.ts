import { LogPattern } from "@/models/LogPattern";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "bun:test";
import { LogFilter } from "./LogFilter";
import { LogRange } from "./LogRange";

describe("LogFilter", () => {
  function params(query: string): URLSearchParams {
    return new URLSearchParams(query);
  }

  describe("from", () => {
    it("reads an empty url as narrowing nothing but the default span", () => {
      // when
      const applied = LogFilter.from(params(""));
      // then
      expect(applied.pattern).toEqual("");
      expect(applied.variant).toEqual(LogPattern.Variant.substr);
      expect(LogRange.equals(applied.range, { kind: "preset", id: "last30d" })).toEqual(true);
    });

    it("reads a pattern and its variant", () => {
      // when
      const applied = LogFilter.from(params("filter=GET+%2F&filterVariant=regex"));
      // then
      expect(applied.pattern).toEqual("GET /");
      expect(applied.variant).toEqual(LogPattern.Variant.regex);
    });

    it("treats any other variant as a plain substring", () => {
      // when
      const applied = LogFilter.from(params("filter=x&filterVariant=nonsense"));
      // then
      expect(applied.variant).toEqual(LogPattern.Variant.substr);
    });
  });

  describe("key", () => {
    it("ignores the marker, so dismissing one cannot re-fetch", () => {
      // given -- the same filter, once with a pin on it
      const bare = LogFilter.key(params("filter=boom&range=last1h"));
      const pinned = LogFilter.key(params("filter=boom&range=last1h&at=2026-03-01T09:00:00Z"));
      // then
      expect(pinned).toEqual(bare);
    });

    it("changes when any part of the filter does", () => {
      // given
      const before = LogFilter.key(params("filter=boom"));
      // then
      expect(LogFilter.key(params("filter=bang"))).not.toEqual(before);
      expect(LogFilter.key(params("filter=boom&filterVariant=regex"))).not.toEqual(before);
      expect(LogFilter.key(params("filter=boom&range=last1h"))).not.toEqual(before);
      expect(LogFilter.key(params("filter=boom&range=custom&since=2026-03-01T00:00:00Z"))).not.toEqual(before);
    });
  });

  describe("toRequest", () => {
    it("drops an empty pattern rather than sending one that matches everything", () => {
      // when
      const request = LogFilter.toRequest(LogFilter.from(params("")));
      // then
      expect(request.pattern).toEqual(undefined);
    });

    it("resolves a relative span into instants", () => {
      // when
      const request = LogFilter.toRequest(LogFilter.from(params("range=last1h")));
      // then -- an open end, because "the last hour" has no future edge
      expect(request.since).toBeString();
      expect(request.until).toEqual(undefined);
    });

    it("resolves against the clock now, so a relative span keeps sliding", () => {
      // given
      const applied = LogFilter.from(params("range=last10m"));
      const before = LogFilter.toRequest(applied);
      // when (the same applied filter, asked again a moment later)
      const after = LogFilter.toRequest(applied);
      // then
      const moved = Temporal.Instant.compare(Temporal.Instant.from(after.since!), Temporal.Instant.from(before.since!));
      expect(moved).toBeGreaterThanOrEqual(0);
    });

    it("closes both ends for the one preset that has a past", () => {
      // when
      const request = LogFilter.toRequest(LogFilter.from(params("range=yesterday")));
      // then
      expect(request.since).toBeString();
      expect(request.until).toBeString();
    });
  });

  describe("narrows", () => {
    it("is false only when nothing at all is being asked for", () => {
      expect(LogFilter.narrows(LogFilter.from(params("range=all")))).toEqual(false);
      expect(LogFilter.narrows(LogFilter.from(params("range=all&filter=boom")))).toEqual(true);
      // the default span is itself a narrowing, so an empty window means "not in the last 30 days"
      expect(LogFilter.narrows(LogFilter.from(params("")))).toEqual(true);
    });
  });

  describe("toParams", () => {
    it("keeps a marker that was already there", () => {
      // when
      const result = LogFilter.toParams(LogFilter.from(params("filter=boom")), "2026-03-01T09:00:00Z");
      // then
      expect(result.at).toEqual("2026-03-01T09:00:00Z");
      expect(result.filter).toEqual("boom");
    });

    it("writes no variant for a filter that is not there", () => {
      // when
      const result = LogFilter.toParams(LogFilter.from(params("filterVariant=regex")), null);
      // then -- a lone variant would read as a filter in the url
      expect(result.filter).toBeUndefined();
      expect(result.filterVariant).toBeUndefined();
    });
  });

  describe("equals", () => {
    it("compares by meaning rather than by identity", () => {
      // given -- the picker hands back a fresh object every time
      const one = LogFilter.from(params("filter=boom&range=last1h"));
      const other = LogFilter.from(params("filter=boom&range=last1h"));
      // then
      expect(LogFilter.equals(one, other)).toEqual(true);
      expect(LogFilter.equals(one, LogFilter.from(params("filter=boom&range=last24h")))).toEqual(false);
    });
  });
});
