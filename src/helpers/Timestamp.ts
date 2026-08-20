import { Temporal } from "@js-temporal/polyfill";

export namespace Timestamp {
  export function tryInstant(timestamp?: string): Temporal.Instant | undefined {
    if (timestamp) {
      try {
        return Temporal.Instant.from(timestamp);
      } catch (error) {
        console.warn("Failed to parse instant timestamp", error);
      }
    }
  }

  export function compareInstants(a?: Temporal.Instant, b?: Temporal.Instant): boolean {
    if (a && b) {
      return Temporal.Instant.compare(a, b) === 0;
    }
    if (a === undefined && b === undefined) {
      return true;
    }
    return false;
  }
}
