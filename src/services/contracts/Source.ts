import { Container } from "@/models/Container";
import { Host } from "@/models/Host";
import { LiveStats } from "@/models/LiveStats";
import { StreamVariant } from "@/models/StreamVariant";
import { Temporal } from "@js-temporal/polyfill";

export interface Source {
  listRunningContainers(): Promise<Container[]>;
  inspectHost(): Promise<Host.Identity>;
  streamLifecycles(signal: AbortSignal): AsyncGenerator<Source.Lifecycle>;
  streamLogLines(id: string, signal: AbortSignal): AsyncGenerator<Source.LogLine>;
  streamStats(id: string, signal: AbortSignal): AsyncGenerator<Source.Stats>;
}

export namespace Source {
  export type LogLine = {
    streamVariant: StreamVariant;
    timestamp: Temporal.Instant;
    line: string;
  };

  export type Lifecycle = {
    status: "start" | "die";
    timestamp: Temporal.Instant;
    container: Container;
  };

  // the measured half of LiveStats, so a sample spreads into it by name; usage is in cores and bytes, like the totals
  export type Stats = Pick<LiveStats, "cpuUsage" | "cpuTotal" | "memoryUsage" | "memoryTotal">;
}
