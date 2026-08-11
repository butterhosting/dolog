import { Temporal } from "@js-temporal/polyfill";

/**
 * The time span a filter covers, as the reader chose it rather than as the server will see it.
 *
 * Relative spans exist only here. "Last hour" is not a thing the api can be told -- it would have to
 * decide *when* the hour ended, and would answer differently a minute later. So the browser holds
 * the intent, resolves it against the clock at the moment of each request, and the server only ever
 * receives two instants. That is also what makes a reloaded `?range=last1h` mean the last hour
 * *now*, which is the only reading of it anyone expects.
 *
 * Named `LogRange` because `Range` is already a DOM global.
 */
export namespace LogRange {
  type PresetId = "all" | "last10m" | "last30m" | "last1h" | "last24h" | "last7d" | "last30d" | "today" | "yesterday";

  export type Value =
    | {
        kind: "preset";
        id: PresetId;
      }
    | {
        kind: "custom";
        since?: Temporal.Instant;
        until?: Temporal.Instant;
      };

  /** What the server is told: two optional instants, and nothing about how they were arrived at. */
  type Window = { since?: Temporal.Instant; until?: Temporal.Instant };

  /**
   * Opening on a bounded span rather than on everything: a month is far more log than anyone reads
   * in one sitting, and asking for all of history by default makes the widest query the one nobody
   * chose. Unrelated to retention, which happens to prune at thirty days in development.
   */
  const DEFAULT_ID: PresetId = "last30d";

  type Preset = { id: PresetId; label: string; group: "relative" | "exact"; window: (now: Temporal.Instant) => Window };

  function midnight(now: Temporal.Instant, daysAgo: number): Temporal.Instant {
    return now.toZonedDateTimeISO("UTC").startOfDay().subtract({ days: daysAgo }).toInstant();
  }

  function lastly(minutes: number): (now: Temporal.Instant) => Window {
    return (now) => ({ since: now.subtract({ minutes }) });
  }

  export const PRESETS: Preset[] = [
    { id: "last10m", label: "Last 10m", group: "relative", window: lastly(10) },
    { id: "last30m", label: "Last 30m", group: "relative", window: lastly(30) },
    { id: "last1h", label: "Last 1h", group: "relative", window: lastly(60) },
    { id: "last24h", label: "Last 24h", group: "relative", window: lastly(60 * 24) },
    { id: "last7d", label: "Last 7d", group: "relative", window: lastly(60 * 24 * 7) },
    { id: "last30d", label: "Last 30d", group: "relative", window: lastly(60 * 24 * 30) },
    { id: "all", label: "All time", group: "relative", window: () => ({}) },
    { id: "today", label: "Today", group: "exact", window: (now) => ({ since: midnight(now, 0) }) },
    /**
     * The only preset with a closed end, and so the only one whose view has no future. Everything
     * downstream reads that from `until` alone -- a bounded end *means* the live feed is irrelevant,
     * which saves carrying a separate "is this historical" flag around.
     */
    { id: "yesterday", label: "Yesterday", group: "exact", window: (now) => ({ since: midnight(now, 1), until: midnight(now, 0) }) },
  ];

  function preset(id: PresetId): Preset {
    return PRESETS.find((candidate) => candidate.id === id)!;
  }

  /**
   * Resolved against the clock, which is why it takes `now` rather than reading it: every request
   * asks again, so "last hour" means the last hour *then*, and a window left open slides on its own.
   */
  export function window(value: LogRange.Value, now: Temporal.Instant): Window {
    return value.kind === "preset" ? preset(value.id).window(now) : { since: value.since, until: value.until };
  }

  /** What the browser's address bar carries: the choice, not the instants it resolved to. */
  export function toParams(value: LogRange.Value): Record<string, string> {
    if (value.kind === "preset") {
      return value.id === DEFAULT_ID ? {} : { range: value.id };
    }
    return {
      range: "custom",
      ...(value.since ? { since: value.since.toString() } : {}),
      ...(value.until ? { until: value.until.toString() } : {}),
    };
  }

  export function fromParams(params: URLSearchParams): LogRange.Value {
    const range = params.get("range");
    if (range === "custom") {
      const read = (key: string) => {
        const raw = params.get(key);
        try {
          return raw ? Temporal.Instant.from(raw) : undefined;
        } catch {
          return undefined;
        }
      };
      return { kind: "custom", since: read("since"), until: read("until") };
    }
    return { kind: "preset", id: PRESETS.some((candidate) => candidate.id === range) ? (range as PresetId) : DEFAULT_ID };
  }

  /** Whether the span narrows anything at all, which changes what an empty window means. */
  export function isAll(value: LogRange.Value): boolean {
    return value.kind === "preset" && value.id === "all";
  }

  /** Compared by what they mean, since the picker hands back a fresh object every time. */
  export function equals(a: LogRange.Value, b: LogRange.Value): boolean {
    if (a.kind === "preset" || b.kind === "preset") {
      return a.kind === "preset" && b.kind === "preset" && a.id === b.id;
    }
    const same = (one?: Temporal.Instant, other?: Temporal.Instant) =>
      one === undefined ? other === undefined : other !== undefined && Temporal.Instant.compare(one, other) === 0;
    return same(a.since, b.since) && same(a.until, b.until);
  }

  export function label(value: LogRange.Value): string {
    if (value.kind === "preset") {
      return preset(value.id).label;
    }
    const shown = (instant: Temporal.Instant | undefined, fallback: string) =>
      instant ? instant.toString({ smallestUnit: "minute" }).replace("T", " ").replace("Z", "") : fallback;
    return `${shown(value.since, "the beginning")} → ${shown(value.until, "now")}`;
  }
}
