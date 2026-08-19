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

    const result: Line[] = [];
    if (hasOlder) {
      const type = Line.Type.scroll_teaser;
      const direction = Direction.backwards_in_time;
      result.push({ id: `${type}:${direction}`, type, direction });
    } else {
      result.push({
        id: Line.Type.beginning_of_time,
        type: Line.Type.beginning_of_time,
      });
    }

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
        result.push({
          id: anchorTimestamp!.toString(),
          type: Line.Type.timestamp_anchor,
          timestamp: anchor!.value as Temporal.Instant,
        });
      }
      if (firstOfDay) {
        result.push({
          id: firstOfDay.toString(),
          type: Line.Type.day_transition,
          day: firstOfDay,
        });
      }
      if (landedAtThisEvent && !landedAtThisEventBeforeTheDayBegan) {
        result.push({
          id: anchorTimestamp!.toString(),
          type: Line.Type.timestamp_anchor,
          timestamp: anchor!.value as Temporal.Instant,
        });
      }
      result.push({
        id: event.id,
        type: Line.Type.event,
        event,
        isAnchored: event.id === anchorId,
      });
    });

    if (anchorTimestamp !== undefined && landedAt === undefined) {
      result.push({
        id: anchorTimestamp.toString(),
        type: Line.Type.timestamp_anchor,
        timestamp: anchor!.value as Temporal.Instant,
      });
    }
    if (hasNewer) {
      const type = Line.Type.scroll_teaser;
      const direction = Direction.forwards_in_time;
      result.push({ id: `${type}:${direction}`, type, direction });
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
    anchor?: LogAnchor;
    events: ContainerEvent[];
    hasOlder: boolean;
    hasNewer: boolean;
    landedAt?: string;
  };
}
