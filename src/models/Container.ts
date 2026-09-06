import { EqualsFactory } from "@/helpers/EqualsFactory";
import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";
import { LiveStats } from "./LiveStats";

export type Container = {
  object: "container";
  did: string; // "Docker ID"
  dname: string; // "Docker name"
  dgroup?: string; // "Docker group"
  liveStats?: LiveStats; // presence/absence indicates online/offline
};

export namespace Container {
  export const parse = ZodParser.forType<Container>()
    .ensureSchemaMatchesType(() =>
      z.object({
        object: z.literal("container"),
        did: z.string(),
        dname: z.string(),
        dgroup: z.string().optional(),
        liveStats: LiveStats.parse.SCHEMA.optional(),
      }),
    )
    .ensureTypeMatchesSchema();

  export const equals = EqualsFactory.createEquals<Container>({
    object: (a, b) => a === b,
    did: (a, b) => a === b,
    dname: (a, b) => a === b,
    dgroup: (a, b) => a === b,
    liveStats: LiveStats.equals,
  });
}
