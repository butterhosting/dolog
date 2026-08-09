import { LogError } from "@/errors/LogError";
import { ZodParser } from "../helpers/ZodParser";
import z from "zod/v4";

export type LogPattern = {
  pattern: string;
  patternVariant: LogPattern.Variant;
};

export namespace LogPattern {
  export enum Variant {
    substr = "substr",
    regex = "regex",
  }

  export function predicate({ pattern, patternVariant }: LogPattern): (line: string) => boolean {
    try {
      switch (patternVariant) {
        case LogPattern.Variant.substr: {
          const lowered = Internal.asciiLower(pattern);
          return (line) => Internal.asciiLower(line).includes(lowered);
        }
        case LogPattern.Variant.regex: {
          const compiled = new RegExp(pattern);
          return (line) => compiled.test(line);
        }
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw LogError.invalid_search_pattern({
          pattern: pattern,
          reason: error.message,
        });
      }
      throw error;
    }
  }

  namespace Internal {
    /**
     * Case is folded across `a-z` and no further, which is deliberate rather than lazy: sqlite's
     * `like` folds exactly that much, and a literal needle is answered by `like` wherever the rows
     * are on disk. Folding more here would make this the *looser* of the two, and the query would
     * then drop lines before anything could test them -- `'café' like '%CAFÉ%'` is false, and
     * `İ`, being an `i` once javascript has lowered it, is not one to sqlite.
     *
     * The cost is that a literal needle no longer crosses case outside ascii; a regular expression
     * is the way to ask for that, and is scanned in memory where full folding is available.
     */
    export function asciiLower(value: string): string {
      return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
    }
  }

  export const parse = ZodParser.forType<LogPattern>()
    .ensureSchemaMatchesType(() =>
      z.object({
        pattern: z.string(),
        patternVariant: z.enum(LogPattern.Variant),
      }),
    )
    .ensureTypeMatchesSchema();
}
