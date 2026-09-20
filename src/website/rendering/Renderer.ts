import { Anchor } from "@/models/Anchor";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Timezone } from "@/helpers/Timezone";
import { Direction } from "@/models/Direction";
import { Temporal } from "@js-temporal/polyfill";
import { Line } from "./Line";
import { Env } from "@/Env";

export class Renderer {
  private readonly timezone: string;

  public constructor(env: Pick<Env.Public, "DOLOG_TIMEZONE">) {
    this.timezone = env.DOLOG_TIMEZONE;
  }

  public render({ events, hasOlder, hasNewer, anchor }: Renderer.Options): Line[] {
    if (events.length === 0) {
      return [];
    }

    let timestampAnchor: { line: Line.TimestampAnchor; successorEventId?: string } | undefined;
    if (anchor?.type === "timestamp") {
      timestampAnchor = {
        line: {
          id: anchor.value.toString(),
          type: Line.Type.timestamp_anchor,
          timestamp: anchor.value,
        },
        successorEventId: events.find((event) => Temporal.Instant.compare(event.timestamp, anchor.value) >= 0)?.id,
      };
    }

    const result: Line[] = [];
    if (hasOlder) {
      const type = Line.Type.scroll_teaser;
      const direction = Direction.backwards_in_time;
      result.push({
        id: `${type}:${direction}`,
        type,
        direction,
      });
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
        firstOfDay = this.day(previousEvent).equals(this.day(event)) ? undefined : this.day(event);
      } else {
        firstOfDay = hasOlder ? undefined : this.day(event);
      }

      const shouldInsertTimestampAnchor = timestampAnchor?.successorEventId === event.id;
      const shouldInsertTimestampAnchorBeforeDayTransition = Boolean(
        firstOfDay && //
        anchor?.type === "timestamp" &&
        Temporal.Instant.compare(anchor.value, this.midnight(firstOfDay)) <= 0,
      );

      if (timestampAnchor && shouldInsertTimestampAnchor && shouldInsertTimestampAnchorBeforeDayTransition) {
        result.push(timestampAnchor.line);
      }
      if (firstOfDay) {
        result.push({
          id: firstOfDay.toString(),
          type: Line.Type.day_transition,
          day: firstOfDay,
        });
      }
      if (timestampAnchor && shouldInsertTimestampAnchor && !shouldInsertTimestampAnchorBeforeDayTransition) {
        result.push(timestampAnchor.line);
      }

      result.push({
        id: event.id,
        type: Line.Type.event,
        event,
        isAnchored: anchor?.type === "id" && event.id === anchor.value,
      });
    });

    if (timestampAnchor && !timestampAnchor.successorEventId) {
      result.push(timestampAnchor.line); // no successor, so this has to be last
    }

    if (hasNewer) {
      const type = Line.Type.scroll_teaser;
      const direction = Direction.forwards_in_time;
      result.push({ id: `${type}:${direction}`, type, direction });
    }

    return result;
  }

  private day(event: ContainerEvent): Temporal.PlainDate {
    return Timezone.dayOf(event.timestamp, this.timezone);
  }

  private midnight(date: Temporal.PlainDate): Temporal.Instant {
    return Timezone.midnight(date, this.timezone);
  }
}

export namespace Renderer {
  export type Options = {
    anchor?: Anchor;
    events: ContainerEvent[];
    hasOlder: boolean;
    hasNewer: boolean;
  };
}
