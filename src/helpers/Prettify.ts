import { Temporal } from "@js-temporal/polyfill";

export namespace Prettify {
  export function timestamp(instant: Temporal.Instant): string {
    // TODO: timzezone
    const at = instant.toZonedDateTimeISO("UTC");
    return `${day(at.toPlainDate())} ${pad(at.hour)}:${pad(at.minute)}:${pad(at.second)}`;
  }

  export function day(date: Temporal.PlainDate): string {
    return `${pad(date.day)}-${pad(date.month)}-${date.year}`;
  }

  export function dayTransition(date: Temporal.PlainDate): string {
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return `${months[date.month - 1]} ${date.day}, ${date.year}`;
  }

  function pad(value: number): string {
    return `${value}`.padStart(2, "0");
  }
}
