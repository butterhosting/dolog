import { Temporal } from "@js-temporal/polyfill";

export namespace TimestampPrefix {
  export function length(line: string, timestamp: Temporal.Instant): number {
    const match = Internal.SHAPE.exec(line);
    if (!match) return 0;
    const [prefix, open, year, , month, day, hour, minute, second, fraction = "", zone, close, spaces] = match;
    if (Boolean(open) !== Boolean(close) || (!open && !spaces) || prefix.length === line.length) return 0;
    if (+month < 1 || +month > 12 || +day < 1 || +day > 31 || +hour > 23 || +minute > 59 || +second > 60) return 0;

    const offset = Internal.offsetOf(zone);
    if (offset === undefined) return 0;
    const millis = +fraction.padEnd(3, "0").slice(0, 3);
    const written = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, millis) - offset;
    return Internal.repeats(written - timestamp.epochMilliseconds, zone !== undefined) ? prefix.length : 0;
  }
}

namespace Internal {
  // 2006-01-02T15:04:05Z, [2006-01-02 15:04:05,000], 2006/01/02 15:04:05.000000+07:00
  export const SHAPE =
    /^(\[)?(\d{4})(?<separator>[-/])(\d{2})\k<separator>(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?(Z|[+-]\d{2}:?\d{2})?(\])?([ \t]*)/;

  // loggers often truncate to the second
  const TOLERANCE = 2_000;
  // a zoneless time is likely local: whole quarter hours off utc, at most 14 of them
  const MAX_OFFSET = 14 * 3_600_000;
  const QUARTER = 15 * 60_000;

  export function offsetOf(zone: string | undefined): number | undefined {
    if (zone === undefined || zone === "Z") return 0;
    const [hours, minutes] = [+zone.slice(1, 3), +zone.slice(-2)];
    if (hours > 14 || minutes > 59) return undefined;
    return (zone.startsWith("-") ? -1 : 1) * (hours * 60 + minutes) * 60_000;
  }

  export function repeats(difference: number, zoned: boolean): boolean {
    if (zoned) return Math.abs(difference) <= TOLERANCE;
    if (Math.abs(difference) > MAX_OFFSET + TOLERANCE) return false;
    return Math.abs(difference - Math.round(difference / QUARTER) * QUARTER) <= TOLERANCE;
  }
}
