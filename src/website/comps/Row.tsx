import { Prettify } from "@/helpers/Prettify";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Line } from "@/website/rendering/Line";
import clsx from "clsx";
import { ReactNode } from "react";
import { JSX } from "react/jsx-runtime";
import { ClientFilter } from "../hooks/objects/ClientFilter";

/**
 * Every row lines its message up under the same column. The timestamp is `19ch` because that is
 * exactly what it prints, so the column follows the text size rather than being re-measured for each.
 */
const TIMESTAMP = "w-[19ch] shrink-0 text-left text-c-rule";
// `anywhere` rather than `break-all`, so a long url gives way only where it has to and words stay whole
const MESSAGE = "ml-[2.5ch] min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]";

export namespace Row {
  type BeginningOfTimeProps = {
    line: Line.BeginningOfTime;
  };
  export function BeginningOfTime({ line: _ }: BeginningOfTimeProps) {
    return <Internal.Aside>this is the beginning</Internal.Aside>;
  }

  type ScrollTeaserProps = {
    line: Line.ScrollTeaser;
  };
  export function ScrollTeaser({ line: { direction } }: ScrollTeaserProps): JSX.Element {
    switch (direction) {
      case Direction.backwards_in_time:
        return <Internal.Aside>↑ scroll up for earlier records</Internal.Aside>;
      case Direction.forwards_in_time:
        return <Internal.Aside>↓ scroll down for later records</Internal.Aside>;
    }
  }

  type DayTransitionProps = {
    line: Line.DayTransition;
  };
  export function DayTransition({ line: { day } }: DayTransitionProps) {
    return <Internal.Aside>{Prettify.day(day)}</Internal.Aside>;
  }

  type TimestampAnchorProps = {
    line: Line.TimestampAnchor;
    dismiss: () => unknown;
  };

  export function TimestampAnchor({ line: { timestamp }, dismiss }: TimestampAnchorProps) {
    return (
      <div data-anchored className="relative flex items-center gap-[2ch]">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-c-accent" />
        <span className={clsx(TIMESTAMP, "relative bg-c-surface pr-[1ch] text-c-accent")}>{Prettify.timestamp(timestamp)}</span>
        {/* the moment asked for, which the lines either side of the seam will not say themselves */}
        <button
          onClick={dismiss}
          title="dismiss this marker"
          className="relative bg-c-surface px-[1ch] text-c-accent cursor-pointer hover:brightness-125"
        >
          ×
        </button>
      </div>
    );
  }

  type EventProps = {
    line: Line.Event;
    filter: ClientFilter;
    toggleAnchor: () => unknown;
    match?: "main_match" | "side_match";
  };
  export function Event({ line: { event, isAnchored }, filter, toggleAnchor, match }: EventProps) {
    if (event.type === ContainerEvent.Type.log) {
      return (
        <div
          data-event={event.id} // TODO: use a shared constant for these custom DOM attributes
          data-anchored={isAnchored} // TODO: use a shared constant for these custom DOM attributes
          className={clsx(
            "flex items-start",
            match === "main_match" && "bg-c-accent/30",
            match === "side_match" && "bg-c-accent/12",
            isAnchored && "outline outline-c-accent",
          )}
        >
          <button onClick={toggleAnchor} title="mark this line" className={clsx(TIMESTAMP, "cursor-pointer hover:text-white")}>
            {Prettify.timestamp(event.timestamp)}
          </button>
          <div className={MESSAGE}>{event.line}</div>
        </div>
      );
    }
    switch (event.type) {
      case ContainerEvent.Type.start:
        return <Internal.Aside>🟢 Container started</Internal.Aside>;
      case ContainerEvent.Type.stop:
        return <Internal.Aside>🔴 Container stopped</Internal.Aside>;
      case ContainerEvent.Type.log_throttle: {
        if (filter.pattern) {
          // Don't show the drop count if a filter pattern is currently active ...
          // ... it would be misleading and confusing to show how many records just got dropped in the non-filtered stream
          return <Internal.Aside>⚡️ Container throttled</Internal.Aside>;
        }
        return <Internal.Aside>⚡️ Container throttled; {event.dropCount} messages dropped</Internal.Aside>;
      }
      default:
        event satisfies never;
    }
  }
}

namespace Internal {
  type AsideProps = {
    children: ReactNode;
  };
  export function Aside({ children }: AsideProps) {
    return (
      <div className="my-3">
        <div aria-hidden className="h-px bg-c-rule/30" />
        <div className="text-center py-3 text-white">{children}</div>
        <div aria-hidden className="h-px bg-c-rule/30" />
      </div>
    );
  }
}
