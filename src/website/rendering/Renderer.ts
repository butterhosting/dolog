import { Anchor } from "@/models/Anchor";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Timezone } from "@/helpers/Timezone";
import { Direction } from "@/models/Direction";
import { Temporal } from "@js-temporal/polyfill";
import { Line } from "./Line";
import { Env } from "@/Env";

export class Renderer {
  private readonly timezone: string;
  // the live window drops its oldest line for every new one, so stripes counted by position would all flip each time
  private readonly stripes = new WeakMap<ContainerEvent, boolean>();

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

    const stripes = this.stripe(events);
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

      const above = result.at(-1);
      result.push({
        id: event.id,
        type: Line.Type.event,
        event,
        isAnchored: anchor?.type === "id" && event.id === anchor.value,
        isStriped: stripes[index],
        repeatsTimestamp: above?.type === Line.Type.event && Renderer.continues(above.event, event),
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

  /**
   * Alternates per block of log lines from the same second, outwards from the first event that was already
   * striped, so every event keeps the stripe it was given
   */
  private stripe(events: ContainerEvent[]): boolean[] {
    const blocks: number[] = [];
    events.forEach((event, index) => {
      blocks.push(index === 0 ? 0 : blocks[index - 1] + (Renderer.continues(events[index - 1], event) ? 0 : 1));
    });
    const pivot = Math.max(0, events.findIndex((event) => this.stripes.has(event)));
    const parity = this.stripes.get(events[pivot]) ? 1 : 0;
    return events.map((event, index) => {
      const isStriped = (blocks[index] - blocks[pivot] + parity) % 2 !== 0;
      this.stripes.set(event, isStriped);
      return isStriped;
    });
  }

  private day(event: ContainerEvent): Temporal.PlainDate {
    return Timezone.dayOf(event.timestamp, this.timezone);
  }

  private midnight(date: Temporal.PlainDate): Temporal.Instant {
    return Timezone.midnight(date, this.timezone);
  }
}

export namespace Renderer {
  /**
   * Whether a log line carries on the one before it: both log lines, from the same second. Timestamps show whole
   * seconds, and every zone's seconds start at the same instants, so this holds for any zone.
   */
  export function continues(previous: ContainerEvent, event: ContainerEvent): boolean {
    const second = (instant: Temporal.Instant) => Math.floor(instant.epochMilliseconds / 1000);
    return (
      previous.type === ContainerEvent.Type.log &&
      event.type === ContainerEvent.Type.log &&
      second(previous.timestamp) === second(event.timestamp)
    );
  }

  export type Options = {
    anchor?: Anchor;
    events: ContainerEvent[];
    hasOlder: boolean;
    hasNewer: boolean;
  };
}
