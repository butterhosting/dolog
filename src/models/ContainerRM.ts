import { ZodParser } from "@/helpers/ZodParser";
import { Temporal } from "@js-temporal/polyfill";
import z from "zod/v4";
import { Container } from "./Container";

// read model
export type ContainerRM = Container & {
  running: boolean;
  throttling: boolean;
  logsPerSecond: number;
  firstSeen: Temporal.Instant;
  lastSeen: Temporal.Instant;
};

export namespace ContainerRM {
  export const parse = ZodParser.forType<ContainerRM>()
    .ensureSchemaMatchesType(() =>
      Container.parse.SCHEMA.and(
        z.object({
          running: z.boolean(),
          firstSeen: z.string().transform(ZodParser.instant),
          lastSeen: z.string().transform(ZodParser.instant),
          logsPerSecond: z.number(),
          throttling: z.boolean(),
        }),
      ),
    )
    .ensureTypeMatchesSchema();
}
