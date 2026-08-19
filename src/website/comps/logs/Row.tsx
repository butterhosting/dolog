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
  };
  export function Event({ line: { event, isAnchored }, toggleAnchor }: EventProps) {
    return (
      <div className="p-px flex items-start gap-2" data-anchored={isAnchored}>
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
