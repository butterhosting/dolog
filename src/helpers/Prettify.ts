import { Temporal } from "@js-temporal/polyfill";

export namespace Prettify {
  export function timestamp(instant: Temporal.Instant): string {
    // TODO: timzezone
    const at = instant.toZonedDateTimeISO("UTC");
    return `${day(at.toPlainDate())} ${pad(at.hour)}:${pad(at.minute)}:${pad(at.second)}`;
  }

  function day(date: Temporal.PlainDate): string {
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

  /** 1536 -> "1.5 KiB" */
  export function bytes(count: number): string {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let value = count;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
  }

  /** 0.5 -> "0.50", 4 -> "4" */
  export function cores(count: number): string {
    return Number.isInteger(count) ? `${count}` : count.toFixed(2);
  }

  function pad(value: number): string {
    return `${value}`.padStart(2, "0");
  }
}
