import { LogPattern } from "@/models/LogPattern";
import { Temporal } from "@js-temporal/polyfill";
import type { LogService } from "@/services/LogService";
import { LogRange } from "./LogRange";

/**
 * What the reader has narrowed the log down to -- a pattern, a span, or both.
 *
 * It lives in the url rather than in state, because a narrowed view is one worth linking to and
 * reloading. Everything here is therefore a function of `URLSearchParams` and nothing else.
 *
 * The import of `LogService` is type-only, so this stays a description of the filter rather than a
 * thing that knows how to send one.
 */
export namespace LogFilter {
  export type Applied = {
    pattern: string;
    variant: LogPattern.Variant;
    range: LogRange.Value;
  };

  /** Every url parameter the filter is made of, and so every one a change to it may re-fetch on. */
  const PARAMS = ["filter", "filterVariant", "range", "since", "until"];

  export function from(parameters: URLSearchParams): Applied {
    return {
      pattern: parameters.get("filter") ?? "",
      variant: parameters.get("filterVariant") === "regex" ? LogPattern.Variant.regex : LogPattern.Variant.substr,
      range: LogRange.fromParams(parameters),
    };
  }

  /**
   * What the window load watches, reduced to a string it can compare by value.
   *
   * Deliberately not the whole `URLSearchParams`: that also carries the marker, and a dismissed
   * marker must not re-fetch -- the very thing the anchor exists to prevent.
   */
  export function key(parameters: URLSearchParams): string {
    return PARAMS.map((param) => parameters.get(param) ?? "").join(" ");
  }

  /** The url a filter is applied through, keeping whatever marker was already there. */
  export function toParams(applied: Applied, pinnedAt: string | null): Record<string, string> {
    return {
      ...(pinnedAt ? { at: pinnedAt } : {}),
      ...(applied.pattern ? { filter: applied.pattern, filterVariant: applied.variant } : {}),
      ...LogRange.toParams(applied.range),
    };
  }

  /**
   * The filter as the api takes it: absolute instants, resolved against the clock *now* rather than
   * when the filter was applied, so a relative span keeps meaning what it says. Called afresh per
   * request for exactly that reason -- a memoised result would freeze "the last hour" at the hour
   * the filter was typed in.
   */
  /**
   * Named through `Pick` off the service's own query rather than written out, so a field renamed on
   * the server fails here, on the key. A request is spread flat into the query it belongs to, which
   * is why these carry their `filter` prefix all the way from here.
   */
  type Filter = Pick<LogService.ListQuery, "filterPattern" | "filterPatternVariant" | "filterSince" | "filterUntil">;

  export function toRequest(applied: Applied): Filter {
    const { since, until } = LogRange.window(applied.range, Temporal.Now.instant());
    return {
      filterPattern: applied.pattern || undefined,
      // meaningless without something to read, and sending it alone would look like a filter
      filterPatternVariant: applied.pattern ? applied.variant : undefined,
      filterSince: since,
      filterUntil: until,
    };
  }

  /** Whether anything is being narrowed at all, which changes what an empty window means. */
  export function narrows(applied: Applied): boolean {
    return applied.pattern !== "" || !LogRange.isAll(applied.range);
  }

  /** Compared by what they mean, so a draft can be told apart from the filter already in force. */
  export function equals(one: Applied, other: Applied): boolean {
    return one.pattern === other.pattern && one.variant === other.variant && LogRange.equals(one.range, other.range);
  }
}
