import { Prettify } from "@/helpers/Prettify";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Line } from "@/website/rendering/Line";
import clsx from "clsx";
import { ReactNode } from "react";
import { JSX } from "react/jsx-runtime";

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
    toggleAnchor: () => unknown;
    match?: "main_character" | "side_character";
  };
  export function Event({ line: { event, isAnchored }, toggleAnchor, match }: EventProps) {
    return (
      <div
        data-event={event.id} // TODO: use a shared constant for these custom DOM attributes
        data-anchored={isAnchored} // TODO: use a shared constant for these custom DOM attributes
        className={clsx(
          "flex items-start",
          match === "main_character" && "bg-c-accent/30",
          match === "side_character" && "bg-c-accent/12",
          isAnchored && "outline outline-c-accent",
        )}
      >
        <button onClick={toggleAnchor} title="mark this line" className={clsx(TIMESTAMP, "cursor-pointer hover:text-white")}>
          {Prettify.timestamp(event.timestamp)}
        </button>
        <div className={MESSAGE}>
          {((): JSX.Element | string => {
            switch (event.type) {
              case ContainerEvent.Type.start:
                return "🟢 Container started";
              case ContainerEvent.Type.stop:
                return "🔴 Container stopped";
              case ContainerEvent.Type.log_throttle:
                return `⚡️ Container throttled; ${event.foldCount} messages dropped`;
              case ContainerEvent.Type.log:
                return event.line;
            }
          })()}
        </div>
      </div>
    );
  }
}

namespace Internal {
  export function Aside({ children }: { children: string }) {
    return (
      <div className="my-3">
        <div aria-hidden className="h-px bg-c-rule/30" />
        <div className="text-center py-3 text-c-rule/60">{children}</div>
        <div aria-hidden className="h-px bg-c-rule/30" />
      </div>
    );
  }
}
