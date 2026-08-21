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

  function pad(value: number): string {
    return `${value}`.padStart(2, "0");
  }

  export function describeLastSeenLogs(lastSeen: Temporal.Instant | null): string {
    if (!lastSeen) {
      return "no logs yet";
    }
    const seconds = Math.max(0, Math.round((Date.now() - lastSeen.epochMilliseconds) / 1000));
    if (seconds < 5) {
      return "just now";
    }
    if (seconds < 60) {
      return `${seconds}s ago`;
    }
    if (seconds < 3600) {
      return `${Math.round(seconds / 60)}m ago`;
    }
    return `${Math.round(seconds / 3600)}h ago`;
  }
}
