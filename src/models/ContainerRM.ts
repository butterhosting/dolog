import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";
import { Container } from "./Container";

// read model
export type ContainerRM = Container & {
  running: boolean;
  throttling: boolean;
  logsPerSecond: number;
};

export namespace ContainerRM {
  export const parse = ZodParser.forType<ContainerRM>()
    .ensureSchemaMatchesType(() =>
      Container.parse.SCHEMA.and(
        z.object({
          running: z.boolean(),
          logsPerSecond: z.number(),
          throttling: z.boolean(),
        }),
      ),
    )
    .ensureTypeMatchesSchema();
}
