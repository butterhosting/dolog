import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

export type Container = {
  id: string;
  object: "container";
  name: string;
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
