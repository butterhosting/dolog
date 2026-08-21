import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Line } from "@/website/rendering/Line";
import clsx from "clsx";
import { JSX } from "react/jsx-runtime";

export namespace Row {
  type BeginningOfTimeProps = {
    line: Line.BeginningOfTime;
  };
  export function BeginningOfTime({ line: _ }: BeginningOfTimeProps) {
    return <div>This is the beginning</div>;
  }

  type ScrollTeaserProps = {
    line: Line.ScrollTeaser;
  };
  export function ScrollTeaser({ line: { direction } }: ScrollTeaserProps): JSX.Element {
    switch (direction) {
      case Direction.backwards_in_time:
        return <div>Scroll up for extra records ...</div>;
      case Direction.forwards_in_time:
        return <div>Scroll down for extra records ...</div>;
    }
  }

  type DayTransitionProps = {
    line: Line.DayTransition;
  };
  export function DayTransition({ line: { day } }: DayTransitionProps) {
    return <div>{day.toString()}</div>;
  }

  type TimestampAnchorProps = {
    line: Line.TimestampAnchor;
    dismiss: () => unknown;
  };

  export function TimestampAnchor({ line: { timestamp }, dismiss }: TimestampAnchorProps) {
    return (
      <div data-anchored className="relative py-1">
        <span aria-hidden className="pointer-events-none absolute -left-4 -right-4 top-1/2 h-px bg-c-accent" />
        <button
          onClick={dismiss}
          title="dismiss this marker"
          className={clsx(
            "absolute -left-4 top-1/2 z-10 flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full",
            "bg-c-accent text-[10px] font-bold leading-none text-white transition hover:brightness-110",
          )}
        >
          ×
        </button>
        {/* the moment asked for, which the lines either side of the seam will not say themselves */}
        <span className="relative z-10 ml-4 bg-c-dark-full pr-2 text-[11px] text-c-accent">{timestamp.toString()}</span>
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
          "p-px flex items-start gap-2",
          match === "main_character" && "bg-yellow-400/35 ring-1 ring-yellow-400/60",
          match === "side_character" && "bg-yellow-400/15",
        )}
      >
        <button onClick={toggleAnchor} className={clsx("cursor-pointer text-c-dark-half", isAnchored && "outline-2 outline-red-500")}>
          {event.timestamp.toString()}
        </button>
        <div>{Internal.describeEvent(event)}</div>
      </div>
    );
  }
}

namespace Internal {
  export function describeEvent(event: ContainerEvent): string {
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
}
