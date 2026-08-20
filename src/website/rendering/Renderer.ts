import { ContainerEvent } from "@/models/ContainerEvent";
import { Anchor } from "@/models/Anchor";
import { Line } from "./Line";
import { Temporal } from "@js-temporal/polyfill";
import { Direction } from "@/models/Direction";

export class LineRenderer {
  public render({ events, hasOlder, hasNewer, anchor, landedAt }: LineRenderer.Options): Line[] {
    if (events.length === 0) {
      return [];
    }

    // `at` is whatever the url says right now and can be dismissed; `landedAt` trails behind it,
    // because dismissing a pin does not re-fetch the data
    const anchorId = anchor?.type === "id" ? anchor.value : undefined;
    const anchorInstant = anchor?.type === "timestamp" ? anchor.value : undefined;

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

      const landedAtThisEvent = anchorInstant !== undefined && landedAt === event.id;
      // an instant that is exactly when a line was logged *is* that line, so it is boxed rather than
      // drawn above it: a mark between two lines claims a gap, and here there is none
      const isThisEvent = landedAtThisEvent && Temporal.Instant.compare(anchorInstant, event.timestamp) === 0;
      const marked = landedAtThisEvent && !isThisEvent;
      const markedBeforeTheDayBegan =
        anchorInstant !== undefined && //
        firstOfDay !== undefined &&
        Temporal.Instant.compare(anchorInstant, this.midnight(firstOfDay)) <= 0;

      if (marked && markedBeforeTheDayBegan) {
        result.push(this.timestampAnchor(anchorInstant));
      }
      if (firstOfDay) {
        result.push({
          id: firstOfDay.toString(),
          type: Line.Type.day_transition,
          day: firstOfDay,
        });
      }
      if (marked && !markedBeforeTheDayBegan) {
        result.push(this.timestampAnchor(anchorInstant));
      }
      result.push({
        id: event.id,
        type: Line.Type.event,
        event,
        isAnchored: event.id === anchorId || isThisEvent,
      });
    });

    // the server landing on nothing, while still returning history, is how it says the moment asked
    // for is later than anything logged
    if (anchorInstant !== undefined && landedAt === undefined) {
      result.push(this.timestampAnchor(anchorInstant));
    }
    if (hasNewer) {
      const type = Line.Type.scroll_teaser;
      const direction = Direction.forwards_in_time;
      result.push({ id: `${type}:${direction}`, type, direction });
    }
    return result;
  }

  private timestampAnchor(timestamp: Temporal.Instant): Line.TimestampAnchor {
    return { id: timestamp.toString(), type: Line.Type.timestamp_anchor, timestamp };
  }

  private day(event: ContainerEvent): Temporal.PlainDate {
    return event.timestamp.toZonedDateTimeISO("UTC").toPlainDate();
  }

  private midnight(date: Temporal.PlainDate): Temporal.Instant {
    return date.toZonedDateTime("UTC").toInstant();
  }
}

export namespace LineRenderer {
  export type Options = {
    anchor?: Anchor;
    events: ContainerEvent[];
    hasOlder: boolean;
    hasNewer: boolean;
    landedAt?: string;
  };
}
