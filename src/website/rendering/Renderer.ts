import { ContainerEvent } from "@/models/ContainerEvent";
import { LogAnchor } from "@/models/LogAnchor";
import { Line } from "./Line";
import { Temporal } from "@js-temporal/polyfill";
import { Direction } from "@/models/Direction";

export class Renderer {
  public render({ events, hasOlder, hasNewer, anchor, landedAt }: Renderer.Options): Line[] {
    if (events.length === 0) {
      return [];
    }

    // `at` is whatever the url says right now and can be dismissed; `landedAt` trails behind it,
    // because dismissing a pin does not re-fetch the data
    const anchorId = anchor?.type === "id" ? anchor.serialize() : undefined;
    const anchorTimestamp = anchor?.type === "timestamp" ? anchor.serialize() : undefined;

    const timestampPin: Line.TimestampPin = {
      type: Line.Type.timestamp_pin,
      pastEveryLine: false,
    };

    const result: Line[] = hasOlder
      ? [{ type: Line.Type.more_marker, direction: Direction.backwards_in_time }] //
      : [{ type: Line.Type.beginning_marker }];

    events.forEach((event, index) => {
      const previousEvent: ContainerEvent | undefined = events[index - 1];

      let firstOfDay: Temporal.PlainDate | undefined;
      if (previousEvent) {
        // compared by value: two `PlainDate`s for the same day are still two different objects
        firstOfDay = this.day(previousEvent).equals(this.day(event)) ? undefined : this.day(event);
      } else {
        firstOfDay = hasOlder ? undefined : this.day(event);
      }

      const landedAtThisEvent = Boolean(anchorTimestamp !== undefined) && Boolean(landedAt === event.id);
      const landedAtThisEventBeforeTheDayBegan =
        anchorTimestamp !== undefined && //
        firstOfDay !== undefined &&
        Temporal.Instant.compare(anchorTimestamp, this.midnight(firstOfDay)) <= 0;

      if (landedAtThisEvent && landedAtThisEventBeforeTheDayBegan) {
        result.push(timestampPin);
      }
      if (firstOfDay) {
        result.push({ type: Line.Type.day_marker, date: firstOfDay });
      }
      if (landedAtThisEvent && !landedAtThisEventBeforeTheDayBegan) {
        result.push(timestampPin);
      }
      result.push({
        type: Line.Type.event,
        event,
        pinned: event.id === anchorId,
      });
    });

    if (anchorTimestamp !== undefined && landedAt === undefined) {
      result.push({
        type: Line.Type.timestamp_pin,
        pastEveryLine: true,
      });
    }
    if (hasNewer) {
      result.push({
        type: Line.Type.more_marker,
        direction: Direction.forwards_in_time,
      });
    }
    return result;
  }

  private day(event: ContainerEvent): Temporal.PlainDate {
    return event.timestamp.toZonedDateTimeISO("UTC").toPlainDate();
  }

  private midnight(date: Temporal.PlainDate): Temporal.Instant {
    return date.toZonedDateTime("UTC").toInstant();
  }
}

export namespace Renderer {
  export type Options = {
    events: ContainerEvent[];
    hasOlder: boolean;
    hasNewer: boolean;
    anchor?: LogAnchor;
    landedAt?: string;
  };
}
