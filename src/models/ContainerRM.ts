import { ZodParser } from "@/helpers/ZodParser";
import { Temporal } from "@js-temporal/polyfill";
import z from "zod/v4";
import { Container } from "./Container";

// read model
export type ContainerRM = Container & {
  running: boolean;
  lastSeen: Temporal.Instant | null;
  logsPerSecond: number;
  throttling: boolean;
};

export namespace ContainerRM {
  export const parse = ZodParser.forType<ContainerRM>()
    .ensureSchemaMatchesType(() =>
      Container.parse.SCHEMA.and(
        z.object({
          running: z.boolean(),
          lastSeen: z.string().transform(ZodParser.instant).nullable(),
          logsPerSecond: z.number(),
          throttling: z.boolean(),
        }),
      ),
    )
    .ensureTypeMatchesSchema();
}
