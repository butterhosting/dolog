import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

export type Container = {
  object: "container";
  did: string; // "Docker ID"
  dname: string; // "Docker name"
  dgroup?: string; // "Docker group"
  liveStats?: Container.LiveStats; // only ever set by the fountain's container stream, never on an event or a row
};

export namespace Container {
  /**
   * Memory is in bytes, with the container's limit (or the host's memory, if it has none) as the total.
   * CPU is in cores: `cpuUsage` is how many cores' worth of time it is burning, `cpuTotal` how many it can see.
   */
  export type LiveStats = {
    throttling: boolean;
    logsPerSecond: number;
    memoryTotal: number;
    memoryUsage: number;
    cpuTotal: number;
    cpuUsage: number;
  };

  /** a running container, as far as the fountain knows */
  export type Live = Container & { liveStats: LiveStats }; // TODO: remove this type, work directly with the `Container` object instead ...

  export function changed(was: Live, now: Live): boolean {
    return (
      was.dname !== now.dname ||
      was.dgroup !== now.dgroup ||
      was.liveStats.throttling !== now.liveStats.throttling ||
      was.liveStats.logsPerSecond !== now.liveStats.logsPerSecond ||
      was.liveStats.memoryTotal !== now.liveStats.memoryTotal ||
      was.liveStats.memoryUsage !== now.liveStats.memoryUsage ||
      was.liveStats.cpuTotal !== now.liveStats.cpuTotal ||
      was.liveStats.cpuUsage !== now.liveStats.cpuUsage
    );
  }

  // shared with `Svc`, which carries the same stats for its running container
  export const LIVE_STATS_SCHEMA = z.object({
    throttling: z.boolean(),
    logsPerSecond: z.number(),
    memoryTotal: z.number(),
    memoryUsage: z.number(),
    cpuTotal: z.number(),
    cpuUsage: z.number(),
  });

  export const parse = ZodParser.forType<Container>()
    .ensureSchemaMatchesType(() =>
      z.object({
        object: z.literal("container"),
        did: z.string(),
        dname: z.string(),
        dgroup: z.string().optional(),
        liveStats: LIVE_STATS_SCHEMA.optional(),
      }),
    )
    .ensureTypeMatchesSchema();
}
