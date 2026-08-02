import { Temporal } from "@js-temporal/polyfill";

export namespace Prettify {
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
