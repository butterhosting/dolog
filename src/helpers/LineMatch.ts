export namespace LineMatch {
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
