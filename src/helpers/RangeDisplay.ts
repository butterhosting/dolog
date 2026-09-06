import { Range } from "@/website/hooks/objects/Range";
import { Temporal } from "@js-temporal/polyfill";

export namespace RangeDisplay {
  export enum Group {
    relative = "relative",
    exact = "exact",
  }

  const PRESETS: Record<Range.Preset, { label: string; group: Group }> = {
    [Range.Preset.last5m]: { label: "Last 5m", group: Group.relative },
    [Range.Preset.last10m]: { label: "Last 10m", group: Group.relative },
    [Range.Preset.last30m]: { label: "Last 30m", group: Group.relative },
    [Range.Preset.last1h]: { label: "Last 1h", group: Group.relative },
    [Range.Preset.last24h]: { label: "Last 24h", group: Group.relative },
    [Range.Preset.last7d]: { label: "Last 7d", group: Group.relative },
    [Range.Preset.last30d]: { label: "Last 30d", group: Group.relative },
    [Range.Preset.all]: { label: "All time", group: Group.relative },
    [Range.Preset.today]: { label: "Today", group: Group.exact },
    [Range.Preset.yesterday]: { label: "Yesterday", group: Group.exact },
  };

  export function presetLabel(preset: Range.Preset): string {
    return PRESETS[preset].label;
  }

  export function presetsIn(group: Group): Range.Preset[] {
    return Object.values(Range.Preset).filter((preset) => PRESETS[preset].group === group);
  }

  export function label(range: Range): string {
    if (range.type === "preset") {
      return presetLabel(range.preset);
    }
    const shown = (instant: Temporal.Instant | undefined, fallback: string) =>
      instant ? instant.toString({ smallestUnit: "minute" }).replace("T", " ").replace("Z", "") : fallback;
    return `${shown(range.since, "the beginning")} → ${shown(range.until, "now")}`;
  }
}
