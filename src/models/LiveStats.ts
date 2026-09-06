import { EqualsFactory } from "@/helpers/EqualsFactory";
import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

export type LiveStats = {
  throttling: boolean;
  logsPerSecond: number;
  memoryTotalBytes: number;
  memoryUsage: number;
  cpuTotalCores: number;
  cpuUsage: number;
};

export namespace LiveStats {
  export const parse = ZodParser.forType<LiveStats>()
    .ensureSchemaMatchesType(() =>
      z.object({
        throttling: z.boolean(),
        logsPerSecond: z.number(),
        memoryTotalBytes: z.number(),
        memoryUsage: z.number(),
        cpuTotalCores: z.number(),
        cpuUsage: z.number(),
      }),
    )
    .ensureTypeMatchesSchema();

  export const equals = EqualsFactory.createEquals<LiveStats>({
    memoryTotalBytes: (a, b) => a === b,
    memoryUsage: (a, b) => a === b,
    cpuTotalCores: (a, b) => a === b,
    cpuUsage: (a, b) => a === b,
    logsPerSecond: (a, b) => a === b,
    throttling: (a, b) => a === b,
  });
}
