import { describe, expect, it } from "bun:test";
import { LogAnchor } from "./LogAnchor";

/**
 * The one place that decides what a position in a log *is*. Both ends read the same string with it,
 * so a disagreement here would be a disagreement between the api and the address bar.
 */
describe("LogAnchor", () => {
  describe("parse", () => {
    it("reads a uuid as the line it names", () => {
      // when
      const anchor = LogAnchor.parse("019fe578-e38b-7000-971e-04858335d7ff");
      // then
      expect(anchor).toEqual({ kind: "id", value: "019fe578-e38b-7000-971e-04858335d7ff" });
    });

    it("reads anything else that is a time as the moment it names", () => {
      // when
      const anchor = LogAnchor.parse("2026-03-01T09:00:00Z");
      // then
      expect(anchor?.kind).toEqual("timestamp");
      expect(LogAnchor.value(anchor!)).toEqual("2026-03-01T09:00:00Z");
    });

    it.each([undefined, "", "not-a-time", "2026-13-45T99:00:00Z", "019fe578-e38b-7000-971e"])("anchors nothing for %p", (raw) => {
      // then -- a url holds whatever was typed into it, which is not an error worth showing
      expect(LogAnchor.parse(raw)).toEqual(undefined);
    });
  });

  describe("format", () => {
    it.each([
      "019fe578-e38b-7000-971e-04858335d7ff", //
      "2026-03-01T09:00:00Z",
    ])("round-trips %s", (raw) => {
      // when (parsed and put back, which is what holding one in memory and asking again amounts to)
      const anchor = LogAnchor.parse(raw);
      // then
      expect(LogAnchor.value(anchor!)).toEqual(raw);
    });

    it("normalises a time to the form the api and the url both carry", () => {
      // when (seconds spelled out, which `Temporal` prints back without them)
      const anchor = LogAnchor.parse("2026-03-01T09:00:00.000Z");
      // then
      expect(LogAnchor.value(anchor!)).toEqual("2026-03-01T09:00:00Z");
    });
  });
});
