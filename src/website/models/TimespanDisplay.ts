import { Timespan } from "@/models/Timespan";
import { Temporal } from "@js-temporal/polyfill";

/**
 * How a timespan is written down and arranged for a reader.
 *
 * Kept out of the model deliberately: what `last30d` *means* is shared with the api, but "Last 30d"
 * and which shelf it sits on are this frontend's business and nobody else's.
 */
export namespace TimespanDisplay {
  /** Spans that slide with the clock, and spans pinned to dates. Only a grouping for the picker. */
  export enum Group {
    relative = "relative",
    exact = "exact",
  }

  const PRESETS: Record<Timespan.Preset, { label: string; group: Group }> = {
    [Timespan.Preset.last10m]: { label: "Last 10m", group: Group.relative },
    [Timespan.Preset.last30m]: { label: "Last 30m", group: Group.relative },
    [Timespan.Preset.last1h]: { label: "Last 1h", group: Group.relative },
    [Timespan.Preset.last24h]: { label: "Last 24h", group: Group.relative },
    [Timespan.Preset.last7d]: { label: "Last 7d", group: Group.relative },
    [Timespan.Preset.last30d]: { label: "Last 30d", group: Group.relative },
    [Timespan.Preset.all]: { label: "All time", group: Group.relative },
    [Timespan.Preset.today]: { label: "Today", group: Group.exact },
    [Timespan.Preset.yesterday]: { label: "Yesterday", group: Group.exact },
  };

  export function presetLabel(preset: Timespan.Preset): string {
    return PRESETS[preset].label;
  }

  /** In declaration order, which is the order they are offered in. */
  export function presetsIn(group: Group): Timespan.Preset[] {
    return Object.values(Timespan.Preset).filter((preset) => PRESETS[preset].group === group);
  }

  /** What the toolbar prints on the button: a preset by name, a custom span by its two ends. */
  export function label(timespan: Timespan): string {
    if (timespan.type === "preset") {
      return presetLabel(timespan.preset);
    }
    const shown = (instant: Temporal.Instant | undefined, fallback: string) =>
      instant ? instant.toString({ smallestUnit: "minute" }).replace("T", " ").replace("Z", "") : fallback;
    return `${shown(timespan.since, "the beginning")} → ${shown(timespan.until, "now")}`;
  }
}
