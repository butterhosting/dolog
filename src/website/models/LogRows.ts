import { ContainerEvent } from "@/models/ContainerEvent";
import { LogAnchor } from "@/models/LogAnchor";
import { Temporal } from "@js-temporal/polyfill";

/**
 * The rendered list, derived from the events and from where the reader navigated to.
 *
 * Kept apart from the component that draws it because this is where all the fiddly placement rules
 * live -- which line opens a day, and which of a row's two seams a navigated instant fell on. Those
 * are answerable from values alone, so they are answered here and tested here.
 */
export namespace LogRows {
  /**
   * A line, plus whatever markers belong immediately above it. Markers live beside the log rather
   * than in it -- a synthetic full-width row would read as data, and would come along when copied.
   */
  export type Row = {
    event: ContainerEvent;
    /** The date this line opens, when it differs from the line before it. */
    opensDay: string | null;
    /**
     * Which of this row's two seams a navigation timestamp fell on, if either -- above the day
     * marker, or between it and the line itself.
     */
    landedOn: "day" | "line" | null;
    /**
     * Whether this is the line the reader pinned outright.
     *
     * Kept apart from `landedOn` because the two are different claims and are drawn differently: a
     * seam says "the moment you asked for falls here, between these two lines", and a pin says
     * "this message". A pinned line is boxed where it sits rather than given a rule above it.
     */
    pinned: boolean;
  };

  /** The rendered list, plus the one landing position that belongs to no row: past the last line. */
  export type Result = {
    rows: Row[];
    landedAtEnd: boolean;
  };

  export type Options = {
    events: ContainerEvent[];
    /** Whether there is still data above this window (if not, show a marker on its first line) */
    hasOlder: boolean;
    /**
     * What the reader marked, or null for no marker at all -- a dismissed one included.
     *
     * One tagged value rather than two loose fields, because the two are alternatives and never
     * co-exist. A timestamp keeps its instant rather than just its shape, since where its seam falls
     * against a day heading is decided by comparing the two.
     */
    marker: LogAnchor | null;
    /** The line the *server* settled on for a moment, rather than one re-derived here. */
    landedOn: string | null;
  };

  /** Dates as displayed: the same UTC the timestamps beside each line are printed in. */
  function day(event: ContainerEvent): string {
    return event.timestamp.toString().slice(0, 10);
  }

  /**
   * A day marker stands for the instant its day began, which is what lets a navigated timestamp be
   * placed against it rather than always beneath it.
   */
  function midnight(date: string): Temporal.Instant {
    return Temporal.Instant.from(`${date}T00:00:00Z`);
  }

  export function build({ events, hasOlder, marker, landedOn }: Options): Result {
    // the two markers are drawn differently, so each is pulled out as the thing it draws
    const landedAt = marker?.kind === "timestamp" ? marker.value : null;
    const pinnedLine = marker?.kind === "id" ? marker.value : null;
    // `landedAt` says whether a marker is wanted at all; `landedOn` says where the server put it
    const landedIndex = !landedAt || !landedOn ? -1 : events.findIndex((event) => event.id === landedOn);
    /**
     * Asking for a moment later than anything logged. The server says so by landing on nothing, and
     * answers by reading *backwards*, so the reader is shown the end of history -- and the mark
     * belongs under the last line, because that is where the instant they asked for falls. Leaving
     * it off was the one case where jumping appeared to do nothing at all, which is easy to hit: a
     * picker offers today by default, and today is past the end of any container that has stopped.
     */
    const landedAtEnd = !!landedAt && landedOn === null && events.length > 0;
    const rows: Row[] = events.map((event, index) => {
      const previous = events[index - 1];
      /**
       * The topmost line gets a marker only once there is nothing above it. Otherwise the window
       * merely starts mid-day, and a marker there would claim a day began where it did not.
       */
      const opensDay = previous ? (day(previous) === day(event) ? null : day(event)) : !hasOlder ? day(event) : null;
      return {
        event,
        opensDay,
        /**
         * One rule, applied to both seams: the mark sits above the first thing at or after the
         * instant asked for. A day marker counts as a thing, standing at midnight -- so landing
         * before the day began draws above it, and landing during the day draws below it, rather
         * than the mark always ending up beneath a date it precedes.
         */
        landedOn:
          index !== landedIndex
            ? null
            : opensDay && landedAt && Temporal.Instant.compare(landedAt, midnight(opensDay)) <= 0
              ? "day"
              : "line",
        pinned: event.id === pinnedLine,
      };
    });
    return { rows, landedAtEnd };
  }
}
