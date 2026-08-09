import { ContainerEvent } from "@/models/ContainerEvent";
import { LogPattern } from "@/models/LogPattern";

/** What the find bar lights up, as opposed to what stepping through it goes and fetches. */
export namespace LogMatches {
  export type Result = {
    /** Ids of the loaded lines the needle matches. */
    matched: Set<string>;
    /** Whether the needle is not yet a usable pattern, which the field says by colouring itself. */
    broken: boolean;
  };

  /**
   * Which loaded lines the needle lights up. Only ever a claim about what is in hand -- stepping is
   * what asks the server about lines that are not.
   */
  export function highlight(events: ContainerEvent[], needle: string, variant: LogPattern.Variant): Result {
    const term = needle.trim();
    if (!term) {
      return { matched: new Set(), broken: false };
    }
    try {
      const matches = LogPattern.predicate({ pattern: term, patternVariant: variant });
      return {
        matched: new Set(events.filter((event) => event.type === ContainerEvent.Type.log && matches(event.line)).map((e) => e.id)),
        broken: false,
      };
    } catch {
      // half way through typing an expression, which is not yet an error worth shouting about
      return { matched: new Set(), broken: true };
    }
  }
}
