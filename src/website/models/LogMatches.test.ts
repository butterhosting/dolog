// import { LogPattern } from "@/models/LogPattern";
// import { TestFixture } from "@/testing/TestFixture.test";
// import { describe, expect, it } from "bun:test";
// import { LogMatches } from "./LogMatches";

// describe("LogMatches", () => {
//   const hit = TestFixture.logEvent({ id: "hit", line: "GET /orders 200" });
//   const miss = TestFixture.logEvent({ id: "miss", line: "POST /carts 500" });
//   const started = TestFixture.startEvent({ id: "started" });
//   const events = [hit, miss, started];

//   function highlight(needle: string, variant = LogPattern.Variant.substr): LogMatches.Result {
//     return LogMatches.highlight(events, needle, variant);
//   }

//   it("lights nothing for an empty needle", () => {
//     // when
//     const { matched, broken } = highlight("   ");
//     // then
//     expect(matched.size).toEqual(0);
//     expect(broken).toEqual(false);
//   });

//   it("lights the lines a substring appears in", () => {
//     // when
//     const { matched } = highlight("orders");
//     // then
//     expect([...matched]).toEqual(["hit"]);
//   });

//   it("ignores ascii case, the way the stored query does", () => {
//     // when
//     const { matched } = highlight("ORDERS");
//     // then
//     expect([...matched]).toEqual(["hit"]);
//   });

//   it("never lights an event that has no line to match", () => {
//     // when (a start event carries no text, whatever the needle)
//     const { matched } = highlight("started");
//     // then
//     expect(matched.has("started")).toEqual(false);
//   });

//   it("reads a regular expression when asked to", () => {
//     // when
//     const { matched, broken } = highlight("^GET .* 2\\d\\d$", LogPattern.Variant.regex);
//     // then
//     expect([...matched]).toEqual(["hit"]);
//     expect(broken).toEqual(false);
//   });

//   it("reports a half-typed expression as broken rather than throwing", () => {
//     // when
//     const { matched, broken } = highlight("GET [", LogPattern.Variant.regex);
//     // then -- the field colours itself; nothing is lit while the pattern cannot be read
//     expect(broken).toEqual(true);
//     expect(matched.size).toEqual(0);
//   });

//   it("treats the same half-typed expression as a plain substring", () => {
//     // when
//     const { broken } = highlight("GET [");
//     // then
//     expect(broken).toEqual(false);
//   });
// });
