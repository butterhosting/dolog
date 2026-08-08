import { LogError } from "@/errors/LogError";
import { ZodParser } from "../helpers/ZodParser";
import z from "zod/v4";

export type LogLinePattern = {
  pattern: string;
  patternVariant: LogLinePattern.Variant;
};

export namespace LogLinePattern {
  export enum Variant {
    substr = "substr",
    regex = "regex",
  }

  export function predicate({ pattern, patternVariant }: LogLinePattern): (line: string) => boolean {
    try {
      switch (patternVariant) {
        case LogLinePattern.Variant.substr: {
          const lowered = pattern.toLowerCase();
          return (line) => line.toLowerCase().includes(lowered);
        }
        case LogLinePattern.Variant.regex: {
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

  export const parse = ZodParser.forType<LogLinePattern>()
    .ensureSchemaMatchesType(() =>
      z.object({
        pattern: z.string(),
        patternVariant: z.enum(LogLinePattern.Variant),
      }),
    )
    .ensureTypeMatchesSchema();
}
