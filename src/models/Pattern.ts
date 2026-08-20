import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

export type Pattern = {
  type: Pattern.Type;
  value: string;
};

export namespace Pattern {
  export enum Type {
    substr = "substr",
    regex = "regex",
  }

  export const parse = ZodParser.forType<Pattern>()
    .ensureSchemaMatchesType(() =>
      z.object({
        type: z.enum(Type),
        value: z.string(),
      }),
    )
    .ensureTypeMatchesSchema();
}
