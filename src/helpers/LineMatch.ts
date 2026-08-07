export namespace LineMatch {
  /**
   * How a needle should be read. A union rather than a boolean because "is it a regex" only ever
   * answers two questions, and this is the sort of list that grows a third entry.
   */
  export type Variant = "substr" | "regex";

  export function predicate(needle: string, variant: Variant): (line: string) => boolean {
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
  }
}
