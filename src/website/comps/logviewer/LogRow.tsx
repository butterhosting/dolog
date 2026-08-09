import { ContainerEvent } from "@/models/ContainerEvent";
import { StreamVariant } from "@/models/StreamVariant";
import clsx from "clsx";

/**
 * A row of the log, and the markers that can sit above one.
 *
 * The dom accessors live here too, deliberately: they select on `data-event` and `data-landed`,
 * which are written a few lines further down. Keeping the query beside the attribute means the
 * contract has one owner instead of two files that have to agree from a distance.
 */
export namespace LogRow {
  /**
   * The seam a navigation landed on. Drawn across the boundary between two rows rather than inside
   * one, and absolutely so: it marks the seam without occupying it, adds no height, and never joins
   * a copied selection. The insets bleed it into the container's padding so it spans the full width.
   *
   * Its host is whichever row edge the instant fell on, so it needs a positioned parent either way.
   */
  function LandingRule({ onDismiss }: { onDismiss: () => void }) {
    return (
      <>
        <span aria-hidden className="pointer-events-none absolute -left-4 -right-4 -top-px h-px bg-c-action" />
        {/*
         * The one thing in the column that takes a click, so it is the one thing that keeps its
         * pointer events. Straddling the left edge puts it clear of the timestamps at any width.
         */}
        <button
          onClick={onDismiss}
          title="dismiss this marker"
          className="absolute -left-4 -top-2 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full bg-green-400 text-[10px] font-bold leading-none text-c-dark-full hover:bg-green-300"
        >
          ×
        </button>
      </>
    );
  }

  /**
   * Deliberately quiet: this only says which day the lines beneath it belong to, and a filled pill
   * gave that more weight than the log itself. Dimmed to the same register as the other notes around
   * the list, which also leaves the landing rule as the one coloured thing in the column.
   */
  export function DayMarker({ date, landedOn, onDismiss }: { date: string; landedOn: boolean; onDismiss: () => void }) {
    return (
      <div data-landed={landedOn ? "" : undefined} className="relative flex justify-center py-3 text-[11px] tracking-wide text-c-dark-half">
        {landedOn && <LandingRule onDismiss={onDismiss} />}
        {date}
      </div>
    );
  }

  /**
   * The marker when it sits past every line. Carries the height the rule cannot supply itself,
   * since it is drawn on this element's top edge and would otherwise hang off the end of the list.
   */
  export function TrailingMarker({ onDismiss }: { onDismiss: () => void }) {
    return (
      <div data-landed="" className="relative pt-3 text-[11px] text-c-dark-half">
        <LandingRule onDismiss={onDismiss} />
        <span className="block text-center">nothing was logged after this</span>
      </div>
    );
  }

  export function Line({
    event,
    landedOn,
    onDismiss,
    matched,
    current,
  }: {
    event: ContainerEvent;
    landedOn: boolean;
    onDismiss: () => void;
    matched: boolean;
    current: boolean;
  }) {
    const time = event.timestamp.toString({ smallestUnit: "second" }).replace("T", " ").replace("Z", "");
    return (
      /*
       * Deliberately not `content-visibility: auto`. It does make a long list cheaper, but a skipped
       * line contributes an estimated height, so scrolling to the bottom stops short of it and the
       * live feed reads as paused when it is not. Plain rows keep the geometry exact.
       */
      <div
        data-event={event.id}
        data-landed={landedOn ? "" : undefined}
        className={clsx(
          "relative flex gap-3 whitespace-pre-wrap break-all",
          // every match is lit, faintly; the one being stepped through is lit enough to find at a glance
          matched && "-mx-1 rounded-sm px-1",
          matched && !current && "bg-yellow-400/15",
          current && "bg-yellow-400/35 ring-1 ring-yellow-400/60",
        )}
      >
        {landedOn && <LandingRule onDismiss={onDismiss} />}
        <span className="text-gray-500 shrink-0">{time}</span>
        <span className={clsx("flex-1", colour(event))}>{describe(event)}</span>
      </div>
    );
  }

  function colour(event: ContainerEvent): string {
    switch (event.type) {
      case ContainerEvent.Type.start:
        return "text-green-400";
      case ContainerEvent.Type.stop:
        return "text-red-400";
      case ContainerEvent.Type.log_throttle:
        return "text-yellow-400";
      case ContainerEvent.Type.log:
        return event.streamVariant === StreamVariant.stderr ? "text-red-300" : "";
    }
  }

  function describe(event: ContainerEvent): string {
    switch (event.type) {
      case ContainerEvent.Type.start:
        return "▲ container started";
      case ContainerEvent.Type.stop:
        return "▼ container stopped";
      case ContainerEvent.Type.log_throttle:
        return `⚡ throttled; ${event.foldCount} messages dropped`;
      case ContainerEvent.Type.log:
        return event.line;
    }
  }

  export function element(container: HTMLElement | null, eventId: string): HTMLElement | null {
    return container?.querySelector<HTMLElement>(`[data-event="${CSS.escape(eventId)}"]`) ?? null;
  }

  /** Whatever marker was drawn for a navigation, which is not always on the first row. */
  export function landed(container: HTMLElement | null): HTMLElement | null {
    return container?.querySelector<HTMLElement>("[data-landed]") ?? null;
  }

  /**
   * Overlapping counts, so a line clipped by an edge is still "on screen" -- it is visible to the
   * reader, and the alternative is a chevron that skips whatever happens to straddle the boundary.
   */
  function overlaps(line: HTMLElement, container: HTMLElement): boolean {
    const bounds = container.getBoundingClientRect();
    const rect = line.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom;
  }

  export function onScreen(container: HTMLElement, eventId: string): boolean {
    const line = element(container, eventId);
    return line !== null && overlaps(line, container);
  }

  /** The topmost and bottommost lines in view, which is what an unmatched search anchors on. */
  export function visibleEdges(container: HTMLElement): { first?: string; last?: string } {
    const shown = [...container.querySelectorAll<HTMLElement>("[data-event]")].filter((line) => overlaps(line, container));
    return { first: shown.at(0)?.dataset.event, last: shown.at(-1)?.dataset.event };
  }
}
