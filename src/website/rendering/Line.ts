import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Temporal } from "@js-temporal/polyfill";

export type Line = Line.BeginningOfTime | Line.DayTransition | Line.ScrollTeaser | Line.TimestampAnchor | Line.Event;

export namespace Line {
  export enum Type {
    beginning_of_time = "beginning_of_time",
    day_transition = "day_transition",
    scroll_teaser = "scroll_teaser",
    timestamp_anchor = "timestamp_anchor",
    event = "event",
  }

  type Common = {
    id: string;
  };

  export type BeginningOfTime = Common & {
    type: Type.beginning_of_time;
  };

  export type ScrollTeaser = Common & {
    type: Type.scroll_teaser;
    direction: Direction;
  };

  export type DayTransition = Common & {
    type: Type.day_transition;
    day: Temporal.PlainDate;
  };

  export type TimestampAnchor = Common & {
    type: Type.timestamp_anchor;
    timestamp: Temporal.Instant;
  };

  export type Event = Common & {
    type: Type.event;
    event: ContainerEvent;
    isAnchored: boolean;
  };
}
