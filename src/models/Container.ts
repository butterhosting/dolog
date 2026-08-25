import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

export type Container = {
  object: "container";
  did: string; // "Docker ID"
  dname: string; // "Docker name"
  dgroup?: string; // "Docker group"
  online: boolean;
};

export namespace Container {
  export const parse = ZodParser.forType<Container>()
    .ensureSchemaMatchesType(() =>
      z.object({
        object: z.literal("container"),
        did: z.string(),
        dname: z.string(),
        dgroup: z.string().optional(),
        online: z.boolean(),
      }),
    )
    .ensureTypeMatchesSchema();
}
