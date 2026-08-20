import { Timestamp } from "@/helpers/Timestamp";
import { Temporal } from "@js-temporal/polyfill";

export type Timespan =
  | {
      type: "preset";
      preset: Timespan.Preset;
      materialize(now?: Temporal.Instant): Materialization;
    }
  | {
      type: "custom";
      since?: Temporal.Instant;
      until?: Temporal.Instant;
      materialize(now?: Temporal.Instant): Materialization;
    };

type Materialization = { since?: Temporal.Instant; until?: Temporal.Instant };

export namespace Timespan {
  export enum Type {
    preset = "preset",
    custom = "custom",
  }

  export enum Preset {
    all = "all",
    last10m = "last10m",
    last30m = "last30m",
    last1h = "last1h",
    last24h = "last24h",
    last7d = "last7d",
    last30d = "last30d",
    today = "today",
    yesterday = "yesterday",
  }

  export function forPreset(preset: Preset): Timespan {
    return {
      type: "preset",
      preset,
      materialize(now = Temporal.Now.instant()) {
        return DETAILS[preset].window(now);
      },
    };
  }

  export function forCustom(materialization: Materialization): Timespan {
    return {
      type: "custom",
      ...materialization,
      materialize() {
        return materialization;
      },
    };
  }

  export function equals(a: Timespan, b: Timespan): boolean {
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
    [Preset.last10m]: { window: lastly(10) },
    [Preset.last30m]: { window: lastly(30) },
    [Preset.last1h]: { window: lastly(60) },
    [Preset.last24h]: { window: lastly(60 * 24) },
    [Preset.last7d]: { window: lastly(60 * 24 * 7) },
    [Preset.last30d]: { window: lastly(60 * 24 * 30) },
    [Preset.all]: { window: () => ({}) },
    [Preset.today]: { window: (now) => ({ since: midnight(now, 0) }) },
    /**
     * The only preset with a closed end, and so the only one whose view has no future. Everything
     * downstream reads that from `until` alone -- a bounded end *means* the live feed is irrelevant,
     * which saves carrying a separate "is this historical" flag around.
     */
    [Preset.yesterday]: {
      window: (now) => ({
        since: midnight(now, 1),
        until: midnight(now, 0),
      }),
    },
  };
}
