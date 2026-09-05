import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";
import { Container } from "./Container";

export type Throughput = {
  object: "throughput";
  container: Container;
  throttling: boolean;
  logsPerSecond: number;
  bytesPerSecond: number;
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
      }),
    )
    .ensureTypeMatchesSchema();
}
