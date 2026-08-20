import { ContainerEvent } from "@/models/ContainerEvent";
import { Anchor } from "@/models/Anchor";
import { Line } from "./Line";
import { Temporal } from "@js-temporal/polyfill";
import { Direction } from "@/models/Direction";

export class LineRenderer {
  public render({ events, hasOlder, hasNewer, anchor }: LineRenderer.Options): Line[] {
    if (events.length === 0) {
      return [];
    }

    const anchorId = anchor?.type === "id" ? anchor.value : undefined;
    const anchorInstant = anchor?.type === "timestamp" ? anchor.value : undefined;

    //
    // Where a moment falls is a fact about the lines on screen, so it is read off them rather than
    // carried over from the request that fetched them: lines arrive on the stream and leave when the
    // window pages, and the answer has to move with them.
    //
    let boxedEventId: string | undefined;
    let mark: Line.TimestampAnchor | undefined;
    let markBeforeEventId: string | undefined;
    if (anchorInstant !== undefined) {
      const landedOn = events.find((event) => Temporal.Instant.compare(event.timestamp, anchorInstant) >= 0);
      if (landedOn !== undefined && Temporal.Instant.compare(landedOn.timestamp, anchorInstant) === 0) {
        // an instant that is exactly when a line was logged *is* that line, so it is boxed rather
        // than drawn above it: a mark between two lines claims a gap, and here there is none
        boxedEventId = landedOn.id;
      } else {
        mark = this.timestampAnchor(anchorInstant);
        markBeforeEventId = landedOn?.id; // nothing at or after it means it belongs past every line
      }
    }

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

      const markHere = markBeforeEventId === event.id ? mark : undefined;
      const markedBeforeTheDayBegan =
        anchorInstant !== undefined && //
        firstOfDay !== undefined &&
        Temporal.Instant.compare(anchorInstant, this.midnight(firstOfDay)) <= 0;

      if (markHere && markedBeforeTheDayBegan) {
        result.push(markHere);
      }
      if (firstOfDay) {
        result.push({
          id: firstOfDay.toString(),
          type: Line.Type.day_transition,
          day: firstOfDay,
        });
      }
      if (markHere && !markedBeforeTheDayBegan) {
        result.push(markHere);
      }
      result.push({
        id: event.id,
        type: Line.Type.event,
        event,
        isAnchored: event.id === anchorId || event.id === boxedEventId,
      });
    });

    if (mark && markBeforeEventId === undefined) {
      result.push(mark);
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
  };
}
