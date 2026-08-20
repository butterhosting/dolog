import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Line } from "@/website/rendering/Line";
import clsx from "clsx";
import { JSX } from "react/jsx-runtime";

export namespace Row {
  type BeginningOfTimeProps = {
    line: Line.BeginningOfTime;
  };
  export function BeginningOfTime({ line }: BeginningOfTimeProps) {
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
    return <div data-anchored>{timestamp.toString()}</div>;
  }

  type EventProps = {
    line: Line.Event;
    toggleAnchor: () => unknown;
    /** Lit faintly because the needle matches it, and lit properly when it is the one stepped to. */
    matched?: boolean;
    current?: boolean;
  };
  export function Event({ line: { event, isAnchored }, toggleAnchor, matched, current }: EventProps) {
    return (
      /* `data-event` is how search finds a line in the dom: to ask whether it is loaded at all, to
         read which lines are on screen, and to scroll to one it has just been given */
      <div
        data-event={event.id}
        data-anchored={isAnchored}
        className={clsx(
          "p-px flex items-start gap-2",
          matched && !current && "bg-yellow-400/15",
          current && "bg-yellow-400/35 ring-1 ring-yellow-400/60",
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
