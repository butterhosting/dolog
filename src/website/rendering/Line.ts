import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Temporal } from "@js-temporal/polyfill";

export type Line = Line.Event | Line.BeginningMarker | Line.DayMarker | Line.MoreMarker | Line.TimestampPin;

export namespace Line {
  export enum Type {
    event = "event",
    beginning_marker = "beginning_marker",
    day_marker = "day_marker",
    more_marker = "more_marker",
    timestamp_pin = "timestamp_pin",
  }
  /** There is nothing above this window: it holds the oldest line the container still has. */
  export type BeginningMarker = {
    type: Type.beginning_marker;
  };

  export type MoreMarker = {
    type: Type.more_marker;
    direction: Direction;
  };

  export type Event = {
    type: Type.event;
    event: ContainerEvent;
    /**
     * Whether this is the line the reader pinned outright, which is drawn *on* it rather than
     * above it -- a box round the message, where the pin below is a rule between two of them.
     */
    pinned: boolean;
  };

  export type DayMarker = {
    type: Type.day_marker;
    date: Temporal.PlainDate;
  };

  export type TimestampPin = {
    type: Type.timestamp_pin;
    pastEveryLine: boolean;
  };
}
