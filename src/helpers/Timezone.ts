import { Temporal } from "@js-temporal/polyfill";

export class Timezone {
  public static check(timezone: string): boolean {
    try {
      Temporal.ZonedDateTime.from({ timeZone: timezone, year: 2000, month: 1, day: 1 });
      return true;
    } catch {
      return false;
    }
  }
}
