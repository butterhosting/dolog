import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { TestFixture } from "@/testing/TestFixture.test";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "bun:test";
import { Line } from "./Line";
import { Renderer } from "./Renderer";

/**
 * The placement rules, which are the whole reason this is a service rather than a loop in the view.
 * Everything here is a pure question about values, so none of it needs a browser.
 *
 * Lines are asserted as a *sequence*, because that is what the rules are about: a date heads the
 * lines below it, and a pin comes before whatever it sits above.
 */
describe(Renderer.name, () => {
  const renderer = new Renderer();

  function at(timestamp: string, id = timestamp): ContainerEvent {
    return TestFixture.logEvent({ id, timestamp: Temporal.Instant.from(timestamp) });
  }

  function build(options: Partial<Renderer.Options> & { events: ContainerEvent[] }): Line[] {
    return renderer.render({ hasOlder: true, hasNewer: false, at: null, landedAt: null, ...options });
  }

  /** Each row as one readable token, so a test can state the whole shape of the list at once. */
  function shape(rows: Line[]): string[] {
    return rows.map((row): string => {
      switch (row.type) {
        case Line.Type.beginning_marker:
          return "beginning";
        case Line.Type.more_marker:
          return row.direction === Direction.backwards_in_time ? "more:older" : "more:newer";
        case Line.Type.day_marker:
          return `day:${row.date.toString()}`;
        case Line.Type.timestamp_pin:
          return row.pastEveryLine ? "pin:past-every-line" : "pin";
        case Line.Type.event:
          return row.pinned ? `line:${row.event.id}:pinned` : `line:${row.event.id}`;
      }
    });
  }

  /** Drops the leading note, for tests that are about what happens further down the list. */
  function body(rows: Line[]): string[] {
    return shape(rows).slice(1);
  }

  describe("day markers", () => {
    it("heads the lines that begin a new date", () => {
      // given
      const events = [at("2026-03-01T23:59:00Z"), at("2026-03-02T00:01:00Z")];
      // when
      const rows = build({ events });
      // then
      expect(body(rows)).toEqual(["line:2026-03-01T23:59:00Z", "day:2026-03-02", "line:2026-03-02T00:01:00Z"]);
    });

    it("leaves lines within one date unheaded", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z"), at("2026-03-01T17:00:00Z")];
      // when
      const rows = build({ events });
      // then
      expect(body(rows)).toEqual(["line:2026-03-01T09:00:00Z", "line:2026-03-01T17:00:00Z"]);
    });

    it("heads the topmost line only once nothing is above it", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z")];
      // then -- a window starting mid-day must not claim the day began there
      expect(shape(build({ events, hasOlder: true }))).toEqual(["more:older", "line:2026-03-01T09:00:00Z"]);
      expect(shape(build({ events, hasOlder: false }))).toEqual(["beginning", "day:2026-03-01", "line:2026-03-01T09:00:00Z"]);
    });
  });

  describe("the notes at either end", () => {
    it("says which way there is more, and where the log begins", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z")];
      // then -- the top says one or the other, never both, and the bottom only speaks when there is
      // something below to fetch
      expect(shape(build({ events, hasOlder: true, hasNewer: true }))).toEqual([
        "more:older",
        "line:2026-03-01T09:00:00Z",
        "more:newer",
      ]);
      expect(shape(build({ events, hasOlder: false, hasNewer: false }))).toEqual([
        "beginning",
        "day:2026-03-01",
        "line:2026-03-01T09:00:00Z",
      ]);
    });

    it("puts the end of history before the note that there is more of it", () => {
      // given (landed past everything, in a window that still has more below)
      const events = [at("2026-03-01T09:00:00Z")];
      // when
      const rows = build({
        events,
        hasNewer: true,
        at: { kind: "timestamp", value: Temporal.Instant.from("2027-01-01T00:00:00Z") },
        landedAt: null,
      });
      // then -- the mark belongs to the log, the note belongs to the window around it
      expect(body(rows)).toEqual(["line:2026-03-01T09:00:00Z", "pin:past-every-line", "more:newer"]);
    });

    it("says nothing at all about an empty window", () => {
      // then -- why it is empty is the page's answer, and it needs the filter to give it
      expect(shape(build({ events: [], hasOlder: true, hasNewer: true }))).toEqual([]);
    });
  });

  describe("the timestamp pin", () => {
    it("draws nothing when no instant was navigated to", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z")];
      // when (a `landedAt` with no `at` is the server answering a question nobody asked -- which is
      // exactly what a dismissed mark leaves behind, since dismissing does not re-fetch)
      const rows = build({ events, landedAt: "2026-03-01T09:00:00Z" });
      // then
      expect(body(rows)).toEqual(["line:2026-03-01T09:00:00Z"]);
    });

    it("comes before the line the server settled on", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z"), at("2026-03-01T10:00:00Z")];
      // when
      const rows = build({
        events,
        at: { kind: "timestamp", value: Temporal.Instant.from("2026-03-01T09:30:00Z") },
        landedAt: "2026-03-01T10:00:00Z",
      });
      // then
      expect(body(rows)).toEqual(["line:2026-03-01T09:00:00Z", "pin", "line:2026-03-01T10:00:00Z"]);
    });

    it("comes before the date when the instant precedes the day", () => {
      // given -- nothing was logged between 23:30 and the next midnight, so the server lands on the
      // first line of the following day, which is also the line that date heads
      const events = [at("2026-03-01T23:00:00Z"), at("2026-03-02T00:05:00Z")];
      // when
      const rows = build({
        events,
        at: { kind: "timestamp", value: Temporal.Instant.from("2026-03-01T23:30:00Z") },
        landedAt: "2026-03-02T00:05:00Z",
      });
      // then -- above the date, since the instant asked for came before that date began
      expect(body(rows)).toEqual(["line:2026-03-01T23:00:00Z", "pin", "day:2026-03-02", "line:2026-03-02T00:05:00Z"]);
    });

    it("comes after the date when the instant falls inside the day", () => {
      // given
      const events = [at("2026-03-01T23:00:00Z"), at("2026-03-02T09:00:00Z")];
      // when
      const rows = build({
        events,
        at: { kind: "timestamp", value: Temporal.Instant.from("2026-03-02T08:00:00Z") },
        landedAt: "2026-03-02T09:00:00Z",
      });
      // then
      expect(body(rows)).toEqual(["line:2026-03-01T23:00:00Z", "day:2026-03-02", "pin", "line:2026-03-02T09:00:00Z"]);
    });

    it("counts midnight itself as the day beginning", () => {
      // given
      const events = [at("2026-03-01T23:00:00Z"), at("2026-03-02T09:00:00Z")];
      // when
      const rows = build({
        events,
        at: { kind: "timestamp", value: Temporal.Instant.from("2026-03-02T00:00:00Z") },
        landedAt: "2026-03-02T09:00:00Z",
      });
      // then
      expect(body(rows)).toEqual(["line:2026-03-01T23:00:00Z", "pin", "day:2026-03-02", "line:2026-03-02T09:00:00Z"]);
    });

    it("sits past every line when the instant was later than anything logged", () => {
      // given (the server says so by landing on nothing while still returning history)
      const events = [at("2026-03-01T09:00:00Z")];
      // when
      const rows = build({
        events,
        at: { kind: "timestamp", value: Temporal.Instant.from("2027-01-01T00:00:00Z") },
        landedAt: null,
      });
      // then
      expect(body(rows)).toEqual(["line:2026-03-01T09:00:00Z", "pin:past-every-line"]);
    });

    it("is left off when there is no history to sit past", () => {
      // when
      const rows = build({
        events: [],
        at: { kind: "timestamp", value: Temporal.Instant.from("2027-01-01T00:00:00Z") },
        landedAt: null,
      });
      // then -- an empty window says "nothing was logged", which a mark would only muddle
      expect(shape(rows)).toEqual([]);
    });
  });

  describe("a pinned line", () => {
    it("marks nothing when no line is pinned", () => {
      // given
      const events = [at("2026-03-01T09:00:00Z"), at("2026-03-01T10:00:00Z")];
      // when
      const rows = build({ events });
      // then
      expect(body(rows)).toEqual(["line:2026-03-01T09:00:00Z", "line:2026-03-01T10:00:00Z"]);
    });

    it("is boxed where it sits, with no pin of its own", () => {
      // given -- the server reports a landing for a pinned line too: an id anchor reads inclusively,
      // so what it lands on is that very line
      const events = [at("2026-03-01T09:00:00Z"), at("2026-03-01T10:00:00Z")];
      // when
      const rows = build({
        events,
        at: { kind: "id", value: "2026-03-01T10:00:00Z" },
        landedAt: "2026-03-01T10:00:00Z",
      });
      // then -- the mark is about the message, not about a moment falling between two of them
      expect(body(rows)).toEqual(["line:2026-03-01T09:00:00Z", "line:2026-03-01T10:00:00Z:pinned"]);
    });

    it("marks nothing when the pinned line is not in this window", () => {
      // given (paged away from it, or a url naming a line from another container)
      const events = [at("2026-03-01T09:00:00Z")];
      // when
      const rows = build({ events, at: { kind: "id", value: "019fe578-e38b-7000-971e-04858335d7ff" } });
      // then
      expect(body(rows)).toEqual(["line:2026-03-01T09:00:00Z"]);
    });
  });
});
