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

  export function createPredicate({ type, value }: Pattern): (line: string) => boolean {
    switch (type) {
      case Type.substr: {
        // case-insensitive over ascii only, which is what `like` does in sqlite
        const lowered = asciiLower(value);
        return (line) => asciiLower(line).includes(lowered);
      }
      case Type.regex: {
        const compiled = new RegExp(value);
        return (line) => compiled.test(line);
      }
    }
  }

  function asciiLower(value: string): string {
    return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
  }
}
