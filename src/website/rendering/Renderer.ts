import { ContainerEvent } from "@/models/ContainerEvent";
import { LogAnchor } from "@/models/LogAnchor";
import { Line } from "./Line";
import { Temporal } from "@js-temporal/polyfill";
import { Direction } from "@/models/Direction";

export class Renderer {
  public render({ events, hasOlder, hasNewer, at, landedAt }: Renderer.Options): Line[] {
    if (events.length === 0) {
      return [];
    }

    // `at` is whatever the url says right now and can be dismissed; `landedAt` trails behind it,
    // because dismissing a pin does not re-fetch the data
    const atId = at?.kind === "id" ? at.value : null;
    const atTimestamp = at?.kind === "timestamp" ? at.value : null;

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

      const landedAtThisEvent = Boolean(atTimestamp !== null) && Boolean(landedAt === event.id);
      const landedAtThisEventBeforeTheDayBegan =
        atTimestamp !== null && //
        firstOfDay !== undefined &&
        Temporal.Instant.compare(atTimestamp, this.midnight(firstOfDay)) <= 0;

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
        pinned: event.id === atId,
      });
    });

    if (atTimestamp !== null && landedAt === null) {
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
    at?: LogAnchor;
    landedAt?: string;
  };
}
