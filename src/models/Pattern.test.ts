import { Pattern } from "@/models/Pattern";
import { describe, expect, it } from "bun:test";

/**
 * The single definition of "matches" in the app: the server searches with it and the frontend
 * highlights with it. Pinned down here because a disagreement between those two shows up as a line
 * lit in the find bar that stepping refuses to land on, which reads as a broken search rather than
 * as two matchers drifting apart.
 */
describe("Pattern", () => {
  describe("createPredicate", () => {
    function matches(value: string, type = Pattern.Type.substr): (line: string) => boolean {
      return Pattern.createPredicate({ type, value });
    }

    it("finds a substring anywhere in the line", () => {
      expect(matches("orders")("GET /orders 200")).toBe(true);
      expect(matches("orders")("POST /carts 500")).toBe(false);
    });

    it("ignores ascii case, the way the stored query does", () => {
      // sqlite's `like` is case-insensitive over ascii, so the in-memory test has to be too, or the
      // same needle answers differently depending on whether a line was flushed yet
      expect(matches("ORDERS")("GET /orders 200")).toBe(true);
      expect(matches("orders")("GET /ORDERS 200")).toBe(true);
    });

    it("reads a regular expression when asked to", () => {
      const anchored = matches("^GET .* 2\\d\\d$", Pattern.Type.regex);
      expect(anchored("GET /orders 200")).toBe(true);
      expect(anchored("POST /orders 200")).toBe(false);
    });

    it("takes a regular expression as written, rather than case-insensitively", () => {
      // the case rule above is a property of substring matching only; an expression means what it says
      expect(matches("GET", Pattern.Type.regex)("get /orders 200")).toBe(false);
    });

    it("treats regex syntax as literal text when read as a substring", () => {
      expect(matches("GET [")("GET [ /orders")).toBe(true);
      expect(matches("100%")("cache 100% full")).toBe(true);
    });

    it("throws on an expression that cannot be compiled", () => {
      // half-typed rather than wrong: callers decide whether that is an error or just not-yet
      expect(() => matches("GET [", Pattern.Type.regex)).toThrow();
    });
  });
});
