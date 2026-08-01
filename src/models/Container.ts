import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

export type Container = {
  id: string;
  object: "container";
  name: string;
  /**
   * The umbrella a container belongs to: the compose project or the swarm stack.
   * Standalone containers have none.
   */
  group?: string;
};

export namespace Container {
  export const parse = ZodParser.forType<Container>()
    .ensureSchemaMatchesType(() =>
      z.object({
        id: z.string(),
        object: z.literal("container"),
        name: z.string(),
        group: z.string().optional(),
      }),
    )
    .ensureTypeMatchesSchema();
}
