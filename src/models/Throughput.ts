import { ZodParser } from "@/helpers/ZodParser";
import { Temporal } from "@js-temporal/polyfill";
import z from "zod/v4";
import { Container } from "./Container";

/**
 * One container's activity over the throttler's most recent measurement window.
 */
export type Throughput = {
  object: "throughput";
  container: Container;
  throttling: boolean;
  logsPerSecond: number;
  bytesPerSecond: number;
  timestamp: Temporal.Instant;
};

export namespace Throughput {
  export const parse = ZodParser.forType<Throughput>()
    .ensureSchemaMatchesType(() =>
      z.object({
        object: z.literal("throughput"),
        container: Container.parse.SCHEMA,
        throttling: z.boolean(),
        logsPerSecond: z.number(),
        bytesPerSecond: z.number(),
        timestamp: z.string().transform(ZodParser.instant),
      }),
    )
    .ensureTypeMatchesSchema();
}
