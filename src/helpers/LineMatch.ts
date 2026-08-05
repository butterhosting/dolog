export namespace LineMatch {
  /**
   * Whether a log line answers to a needle.
   *
   * Shared deliberately: the server decides which line to *travel* to and the browser decides which
   * lines to *paint*, and the two disagreeing would show a reader highlights that the chevrons skip
   * over, or move them to a line that is not lit up. One rule, imported by both.
   *
   * A literal needle ignores case -- what someone typing a word into a box expects, and what
   * sqlite's `like` does anyway, which is what makes the pushed-down prefilter agree with this. A
   * regular expression is taken exactly as written: its author is being explicit, and javascript
   * offers them no inline flag to say otherwise.
   *
   * Throws on a malformed expression, which is an ordinary thing to receive from someone half way
   * through typing one.
   */
  export function predicate(needle: string, regex: boolean): (line: string) => boolean {
    if (!regex) {
      const lowered = needle.toLowerCase();
      return (line) => line.toLowerCase().includes(lowered);
    }
    const compiled = new RegExp(needle);
    return (line) => compiled.test(line);
  }
}
