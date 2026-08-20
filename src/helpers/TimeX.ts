import { Temporal } from "@js-temporal/polyfill";

export class TimeZone {
  public static check(timeZone: string): boolean {
    try {
      Temporal.ZonedDateTime.from({ timeZone, year: 2000, month: 1, day: 1 });
      return true;
    } catch {
      return false;
    }
  }
}
