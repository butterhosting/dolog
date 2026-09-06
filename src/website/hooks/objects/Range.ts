import { Timestamp } from "@/helpers/Timestamp";
import { Temporal } from "@js-temporal/polyfill";

export type Range =
  | {
      type: "preset";
      preset: Range.Preset;
      materialize(now?: Temporal.Instant): Materialization;
    }
  | {
      type: "custom";
      since?: Temporal.Instant;
      until?: Temporal.Instant;
      materialize(now?: Temporal.Instant): Materialization;
    };

type Materialization = { since?: Temporal.Instant; until?: Temporal.Instant };

export namespace Range {
  export enum Type {
    preset = "preset",
    custom = "custom",
  }

  export enum Preset {
    last5m = "last5m",
    last10m = "last10m",
    last30m = "last30m",
    last1h = "last1h",
    last24h = "last24h",
    last7d = "last7d",
    last30d = "last30d",
    all = "all",
    today = "today",
    yesterday = "yesterday",
  }

  export function forPreset(preset: Preset): Range {
    return {
      type: "preset",
      preset,
      materialize(now = Temporal.Now.instant()) {
        return DETAILS[preset].window(now);
      },
    };
  }

  export function forCustom(materialization: Materialization): Range {
    return {
      type: "custom",
      ...materialization,
      materialize() {
        return materialization;
      },
    };
  }

  export function equals(a: Range, b: Range): boolean {
    if (a.type === "preset" && b.type === "preset") {
      return a.preset === b.preset;
    }
    if (a.type === "custom" && b.type === "custom") {
      return Timestamp.compareInstants(a.since, b.since) && Timestamp.compareInstants(a.until, b.until);
    }
    return false;
  }

  function midnight(now: Temporal.Instant, daysAgo: number): Temporal.Instant {
    return now.toZonedDateTimeISO("UTC").startOfDay().subtract({ days: daysAgo }).toInstant();
  }

  function lastly(minutes: number): (now: Temporal.Instant) => Materialization {
    return (now) => ({ since: now.subtract({ minutes }) });
  }

  type Detail = {
    window(now: Temporal.Instant): Materialization;
  };

  const DETAILS: Record<Preset, Detail> = {
    [Preset.last5m]: { window: lastly(5) },
    [Preset.last10m]: { window: lastly(10) },
    [Preset.last30m]: { window: lastly(30) },
    [Preset.last1h]: { window: lastly(60) },
    [Preset.last24h]: { window: lastly(60 * 24) },
    [Preset.last7d]: { window: lastly(60 * 24 * 7) },
    [Preset.last30d]: { window: lastly(60 * 24 * 30) },
    [Preset.all]: { window: () => ({}) },
    [Preset.today]: { window: (now) => ({ since: midnight(now, 0) }) },
    [Preset.yesterday]: {
      window: (now) => ({
        since: midnight(now, 1),
        until: midnight(now, 0),
      }),
    },
  };
}
