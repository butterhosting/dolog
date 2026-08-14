import { ContainerEvent } from "@/models/ContainerEvent";
import { TestFixture } from "@/testing/TestFixture.test";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "bun:test";
import { LogRows } from "./LogRows";

/**
 * The placement rules, which are the whole reason this is a model rather than a loop in the view.
 * Everything here is a pure question about values, so none of it needs a browser.
 */
describe("LogRows", () => {
  function at(timestamp: string, id = timestamp): ContainerEvent {
    return TestFixture.logEvent({ id, timestamp: Temporal.Instant.from(timestamp) });
  }

  function build(options: Partial<LogRows.Options> & { events: ContainerEvent[] }): LogRows.Result {
    return LogRows.build({ reachedBeginning: false, landedAt: null, landedOn: null, ...options });
  }

  describe("opensDay", () => {
    it("marks the line that begins a new date", () => {
      // given
      const events = [at("2026-03-01T23:59:00Z"), at("2026-03-02T00:01:00Z")];
      // when
      const { rows } = build({ events });
      // then
      expect(rows.map((row) => row.opensDay)).toEqual([null, "2026-03-02"]);
    });

    it("leaves lines within one date unmarked", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z"), at("2026-03-01T17:00:00Z")];
      // when
      const { rows } = build({ events });
      // then
      expect(rows.map((row) => row.opensDay)).toEqual([null, null]);
    });

    it("marks the topmost line only once nothing is above it", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z")];
      // when
      const partial = build({ events, reachedBeginning: false });
      const whole = build({ events, reachedBeginning: true });
      // then -- a window starting mid-day must not claim the day began there
      expect(partial.rows[0]!.opensDay).toEqual(null);
      expect(whole.rows[0]!.opensDay).toEqual("2026-03-01");
    });
  });

  describe("landedOn", () => {
    it("draws nothing when no instant was navigated to", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z")];
      // when (a `landedOn` with no `landedAt` is the server answering a question nobody asked)
      const { rows } = build({ events, landedOn: "2026-03-01T09:00:00Z" });
      // then
      expect(rows.map((row) => row.landedOn)).toEqual([null]);
    });

    it("draws above the line the server settled on", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z"), at("2026-03-01T10:00:00Z")];
      // when
      const { rows } = build({
        events,
        landedAt: Temporal.Instant.from("2026-03-01T09:30:00Z"),
        landedOn: "2026-03-01T10:00:00Z",
      });
      // then
      expect(rows.map((row) => row.landedOn)).toEqual([null, "line"]);
    });

    it("draws above the day marker when the instant precedes the day", () => {
      // given -- nothing was logged between 23:30 and the next midnight, so the server lands on the
      // first line of the following day, whose row also carries that day's marker
      const events = [at("2026-03-01T23:00:00Z"), at("2026-03-02T00:05:00Z")];
      // when
      const { rows } = build({
        events,
        landedAt: Temporal.Instant.from("2026-03-01T23:30:00Z"),
        landedOn: "2026-03-02T00:05:00Z",
      });
      // then -- above the date, since the instant asked for came before that date began
      expect(rows[1]!.opensDay).toEqual("2026-03-02");
      expect(rows[1]!.landedOn).toEqual("day");
    });

    it("draws below the day marker when the instant falls inside the day", () => {
      // given
      const events = [at("2026-03-01T23:00:00Z"), at("2026-03-02T09:00:00Z")];
      // when
      const { rows } = build({
        events,
        landedAt: Temporal.Instant.from("2026-03-02T08:00:00Z"),
        landedOn: "2026-03-02T09:00:00Z",
      });
      // then
      expect(rows[1]!.landedOn).toEqual("line");
    });

    it("counts midnight itself as the day beginning", () => {
      // given
      const events = [at("2026-03-01T23:00:00Z"), at("2026-03-02T09:00:00Z")];
      // when
      const { rows } = build({
        events,
        landedAt: Temporal.Instant.from("2026-03-02T00:00:00Z"),
        landedOn: "2026-03-02T09:00:00Z",
      });
      // then
      expect(rows[1]!.landedOn).toEqual("day");
    });
  });

  describe("pinned", () => {
    it("marks nothing when no line is pinned", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z"), at("2026-03-01T10:00:00Z")];
      // when
      const { rows } = build({ events });
      // then
      expect(rows.map((row) => row.pinned)).toEqual([false, false]);
    });

    it("marks the one line that was pinned", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z"), at("2026-03-01T10:00:00Z")];
      // when
      const { rows } = build({ events, pinnedLine: "2026-03-01T10:00:00Z" });
      // then
      expect(rows.map((row) => row.pinned)).toEqual([false, true]);
    });

    it("draws no seam for a pinned line", () => {
      // given -- a pinned line arrives with no instant, since `at` holds one or the other
      const events = [at("2026-03-01T09:00:00Z"), at("2026-03-01T10:00:00Z")];
      // when
      const { rows, landedAtEnd } = build({ events, pinnedLine: "2026-03-01T10:00:00Z" });
      // then -- the mark is about the message, not about a moment falling between two of them
      expect(rows.map((row) => row.landedOn)).toEqual([null, null]);
      expect(landedAtEnd).toEqual(false);
    });

    it("marks nothing when the pinned line is not in this window", () => {
      // given (paged away from it, or a url naming a line from another container)
      const events = [at("2026-03-01T09:00:00Z")];
      // when
      const { rows } = build({ events, pinnedLine: "019fe578-e38b-7000-971e-04858335d7ff" });
      // then
      expect(rows.map((row) => row.pinned)).toEqual([false]);
    });
  });

  describe("landedAtEnd", () => {
    it("is set when the instant was past everything logged", () => {
      // given (the server says so by landing on nothing while still returning history)
      const events = [at("2026-03-01T09:00:00Z")];
      // when
      const { rows, landedAtEnd } = build({ events, landedAt: Temporal.Instant.from("2027-01-01T00:00:00Z"), landedOn: null });
      // then
      expect(landedAtEnd).toEqual(true);
      expect(rows.map((row) => row.landedOn)).toEqual([null]);
    });

    it("is not set when there is no history to sit past", () => {
      // when
      const { landedAtEnd } = build({ events: [], landedAt: Temporal.Instant.from("2027-01-01T00:00:00Z"), landedOn: null });
      // then -- an empty window says "nothing was logged", which a marker would only muddle
      expect(landedAtEnd).toEqual(false);
    });

    it("is not set when the server did land somewhere", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z")];
      // when
      const { landedAtEnd } = build({
        events,
        landedAt: Temporal.Instant.from("2026-03-01T08:00:00Z"),
        landedOn: "2026-03-01T09:00:00Z",
      });
      // then
      expect(landedAtEnd).toEqual(false);
    });
  });

  describe("parseInstant", () => {
    it("reads an instant back out of the url", () => {
      expect(LogRows.parseInstant("2026-03-01T09:00:00Z")?.toString()).toEqual("2026-03-01T09:00:00Z");
    });

    it.each([null, "", "not-a-time", "2026-13-45T99:00:00Z"])("marks nothing for %p", (value) => {
      // then -- the url is whatever was typed into it, which is not an error worth showing
      expect(LogRows.parseInstant(value)).toEqual(null);
    });
  });
});
