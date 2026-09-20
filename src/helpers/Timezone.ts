import { Temporal } from "@js-temporal/polyfill";

export namespace Timezone {
  export function check(timezone: string): boolean {
    try {
      Temporal.ZonedDateTime.from({ timeZone: timezone, year: 2000, month: 1, day: 1 });
      return true;
    } catch {
      return false;
    }
  }

  export function toWallClock(instant: Temporal.Instant, timezone: string): Temporal.PlainDateTime {
    return instant.toZonedDateTimeISO(timezone).toPlainDateTime();
  }

  export function fromWallClock(wallClock: string, timezone: string): Temporal.Instant | null {
    try {
      return Temporal.PlainDateTime.from(wallClock).toZonedDateTime(timezone).toInstant();
    } catch {
      return null;
    }
  }

  export function dayOf(instant: Temporal.Instant, timezone: string): Temporal.PlainDate {
    return toWallClock(instant, timezone).toPlainDate();
  }

  export function midnight(date: Temporal.PlainDate, timezone: string): Temporal.Instant {
    return date.toZonedDateTime(timezone).toInstant();
  }
}
