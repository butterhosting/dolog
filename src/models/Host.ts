import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

export type Host = {
  hostname: string;
  dockerVersion: string;
  cpuUsage: number; // cores
  cpuTotal: number; // cores
  memoryUsage: number; // bytes
  memoryTotal: number; // bytes
};

export namespace Host {
  export type Identity = Pick<Host, "hostname" | "dockerVersion" | "cpuTotal" | "memoryTotal">;

  export const parse = ZodParser.forType<Host>()
    .ensureSchemaMatchesType(() =>
      z.object({
        hostname: z.string(),
        dockerVersion: z.string(),
        cpuUsage: z.number(),
        cpuTotal: z.number(),
        memoryUsage: z.number(),
        memoryTotal: z.number(),
      }),
    )
    .ensureTypeMatchesSchema();
}
