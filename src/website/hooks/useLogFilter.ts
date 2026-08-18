import { LogPattern } from "@/models/LogPattern";
import { LogService } from "@/services/LogService";
import { Temporal } from "@js-temporal/polyfill";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { LogRange } from "../models/LogRange";
import { useRegistry } from "./useRegistry";

export function useLogFilter(): useLogFilter.Result {
  const dialogClient = useRegistry(DialogClient);
  const [parameters, setParameters] = useSearchParams();

  const key = Internal.PARAMS.map((param) => parameters.get(param) || "").join(" ");
  const filter = useMemo(() => Internal.parseFilter(parameters), [key]);

  // form
  const [pattern, setPattern] = useState(filter.pattern);
  const [patternVariant, setPatternVariant] = useState<LogPattern.Variant>(filter.patternVariant);
  const [range, setRange] = useState<LogRange.Value>(filter.range);
  const dirty = !Internal.equals(filter, {
    pattern: pattern.trim(),
    patternVariant: patternVariant,
    range,
  });

  function togglePatternVariant() {
    setPatternVariant((current) => {
      return current === LogPattern.Variant.regex ? LogPattern.Variant.substr : LogPattern.Variant.regex;
    });
  }

  async function promptRangeDialog() {
    const chosen = await dialogClient.pickRange(range);
    if (chosen !== "cancel") {
      setRange(chosen);
    }
  }

  function apply() {
    setParameters((previous) => Internal.merge(previous, { pattern: pattern.trim(), patternVariant, range }));
  }

  return {
    filter,
    isFilterNarrowing: Internal.isNarrowing(filter),
    form: { pattern, setPattern, patternVariant, togglePatternVariant, range, promptRangeDialog },
    formState: { dirty, apply },
  };
}

namespace Internal {
  export const PARAMS: string[] = [...Object.values(LogService.FilterKey), LogRange.PARAM];

  export function parseFilter(parameters: URLSearchParams): useLogFilter.Filter {
    return {
      pattern: parameters.get(LogService.FilterKey.filterPattern) ?? "",
      patternVariant:
        parameters.get(LogService.FilterKey.filterPatternVariant) === "regex" ? LogPattern.Variant.regex : LogPattern.Variant.substr,
      range: LogRange.fromParams(parameters),
    };
  }

  export function merge(previous: URLSearchParams, filter: useLogFilter.Filter): URLSearchParams {
    const next = new URLSearchParams(previous);
    // clear the params of all existing filter-related params
    PARAMS.forEach((param) => next.delete(param));
    // insert the new filter params
    const filterParams = {
      ...(filter.pattern
        ? {
            [LogService.FilterKey.filterPattern]: filter.pattern,
            [LogService.FilterKey.filterPatternVariant]: filter.patternVariant,
          }
        : {}),
      ...LogRange.toParams(filter.range),
    };
    Object.entries(filterParams).forEach(([param, value]) => next.set(param, value));
    return next;
  }

  export function isNarrowing(applied: useLogFilter.Filter): boolean {
    return applied.pattern !== "" || !LogRange.isAll(applied.range);
  }

  export function equals(one: useLogFilter.Filter, other: useLogFilter.Filter): boolean {
    return one.pattern === other.pattern && one.patternVariant === other.patternVariant && LogRange.equals(one.range, other.range);
  }
}

export namespace useLogFilter {
  export type Result = {
    /**
     * This value is memoized
     */
    filter: Filter;
    isFilterNarrowing: boolean;
    form: {
      pattern: string;
      setPattern: (value: string) => void;
      patternVariant: LogPattern.Variant;
      togglePatternVariant: () => void;
      range: LogRange.Value;
      promptRangeDialog: () => Promise<void>;
    };
    formState: {
      dirty: boolean;
      apply: () => void;
    };
  };

  export type Filter = {
    pattern: string;
    patternVariant: LogPattern.Variant;
    range: LogRange.Value;
  };
  export function serialize(filter: Filter): LogService.FilterSubQuery {
    const { since, until } = LogRange.window(filter.range, Temporal.Now.instant());
    return {
      filterPattern: filter.pattern || undefined,
      // meaningless without something to read, and sending it alone would look like a filter
      filterPatternVariant: filter.pattern ? filter.patternVariant : undefined,
      // stringified here rather than left to whatever the request builder does with an instant
      filterSince: since?.toString(),
      filterUntil: until?.toString(),
    };
  }
}
