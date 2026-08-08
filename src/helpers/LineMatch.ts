import { LogError } from "@/errors/LogError";

export namespace LineMatch {
  export type Variant = "substr" | "regex";

  export function predicate(needle: string, variant: Variant): (line: string) => boolean {
    try {
      switch (variant) {
        case "substr": {
          const lowered = needle.toLowerCase();
          return (line) => line.toLowerCase().includes(lowered);
        }
        case "regex": {
          const compiled = new RegExp(needle);
          return (line) => compiled.test(line);
        }
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw LogError.invalid_search_pattern({
          pattern: needle,
          reason: error.message,
        });
      }
      throw error;
    }
  }
}
