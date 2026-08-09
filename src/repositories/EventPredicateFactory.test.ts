import { Direction } from "@/models/Direction";
import { LogPattern } from "@/models/LogPattern";
import { describe, expect, it } from "bun:test";
import { EventPredicateFactory } from "./EventPredicateFactory";

/**
 * Only what can be judged without a database belongs here. Whether a prefilter really is no
 * stricter than its predicate is a claim about sqlite and javascript agreeing, so it stays in
 * `EventRepository.test.ts` where both halves are actually asked the same question.
 */
describe("EventPredicateFactory", () => {
  const anchorId = "019fe10e-4a9f-700d-8f7c-f6ec636e67dc";
  const later = "019fe10e-4ad6-7061-9172-2c3ecf40c00d";

  describe("forCursor", () => {
    it("should refuse a bound whose inclusivity was never stated", () => {
      // an id with no inclusivity is half an instruction, and guessing which half is how a page
      // silently gains or loses the line the reader was standing on
      expect(() => EventPredicateFactory.forCursor({ before: anchorId })).toThrow(/inclusivity/i);
      expect(() => EventPredicateFactory.forCursor({ after: anchorId })).toThrow(/inclusivity/i);
    });

    it("should accept a cursor that states it, and no cursor at all", () => {
      expect(() => EventPredicateFactory.forCursor({})).not.toThrow();
      expect(() => EventPredicateFactory.forCursor({ before: anchorId, beforeInclusivity: "exclusive" })).not.toThrow();
      expect(() => EventPredicateFactory.forCursor({ after: anchorId, afterInclusivity: "inclusive" })).not.toThrow();
    });
  });

  describe("forSearch", () => {
    const logPattern = { pattern: "needle", patternVariant: LogPattern.Variant.substr };

    it("should keep the anchor itself only when the search is inclusive of it", () => {
      const candidate = { id: anchorId, line: "a needle here" };
      const inclusive = EventPredicateFactory.forSearch({
        logPattern,
        anchorId,
        anchorInclusivity: "inclusive",
        direction: Direction.forwards_in_time,
      });
      const exclusive = EventPredicateFactory.forSearch({
        logPattern,
        anchorId,
        anchorInclusivity: "exclusive",
        direction: Direction.forwards_in_time,
      });

      expect(inclusive.fullInMemoryTest(candidate)).toBe(true);
      expect(exclusive.fullInMemoryTest(candidate)).toBe(false);
    });

    it("should look the way it was told to, whichever line it is handed", () => {
      const forwards = EventPredicateFactory.forSearch({
        logPattern,
        anchorId,
        anchorInclusivity: "exclusive",
        direction: Direction.forwards_in_time,
      });
      const backwards = EventPredicateFactory.forSearch({
        logPattern,
        anchorId,
        anchorInclusivity: "exclusive",
        direction: Direction.backwards_in_time,
      });
      const ahead = { id: later, line: "a needle here" };

      expect(forwards.fullInMemoryTest(ahead)).toBe(true);
      expect(backwards.fullInMemoryTest(ahead)).toBe(false);
    });

    it("should not answer with a line that carries no text at all", () => {
      // a start or a stop is a real event with nothing in it for a pattern to match
      const search = EventPredicateFactory.forSearch({ logPattern, direction: Direction.forwards_in_time });
      expect(search.fullInMemoryTest({ id: later, line: null })).toBe(false);
    });
  });
});
