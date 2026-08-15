import { LogPattern } from "@/models/LogPattern";
import { LogService } from "@/services/LogService";
import { Temporal } from "@js-temporal/polyfill";
import { useCallback, useMemo, useState } from "react";
import type { SetURLSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { LogRange } from "../models/LogRange";
import { useRegistry } from "./useRegistry";

export function useLogFilter({ parameters, setParameters }: useLogFilter.Options): useLogFilter.Result {
  const dialogClient = useRegistry(DialogClient);

  const key = Internal.PARAMS.map((param) => parameters.get(param) || "").join(" ");
  const activeFilter = useMemo(() => Internal.parseFilter(parameters), [key]);

  // form
  const [pattern, setPattern] = useState(activeFilter.pattern);
  const [variant, setVariant] = useState<LogPattern.Variant>(activeFilter.variant);
  const [range, setRange] = useState<LogRange.Value>(activeFilter.range);
  const dirty = !Internal.equals(activeFilter, {
    pattern: pattern.trim(),
    variant,
    range,
  });

  const toggleVariant = useCallback(() => {
    setVariant((current) => {
      return current === LogPattern.Variant.regex ? LogPattern.Variant.substr : LogPattern.Variant.regex;
    });
  }, []);

  const promptRangeDialog = useCallback(async () => {
    const chosen = await dialogClient.pickRange(range);
    if (chosen !== "cancel") {
      setRange(chosen);
    }
  }, [dialogClient, range]);

  // only updates the URL, causing a chain of cascading changes
  // url updates --> this hook's `parameters` arg updates --> this hooks return objects update
  const apply = useCallback(() => {
    setParameters((previous) => Internal.merge(previous, { pattern: pattern.trim(), variant, range }));
  }, [pattern, variant, range, setParameters]);

  return {
    activeFilter,
    isActiveFilterNarrowing: Internal.isNarrowing(activeFilter),
    form: { pattern, setPattern, variant, toggleVariant, range, promptRangeDialog },
    formState: { dirty, apply },
  };
}

namespace Internal {
  export const PARAMS: string[] = [...Object.values(LogService.FilterKey), LogRange.PARAM];

  export function parseFilter(parameters: URLSearchParams): useLogFilter.Filter {
    return {
      pattern: parameters.get(LogService.FilterKey.filterPattern) ?? "",
      variant: parameters.get(LogService.FilterKey.filterPatternVariant) === "regex" ? LogPattern.Variant.regex : LogPattern.Variant.substr,
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
            [LogService.FilterKey.filterPatternVariant]: filter.variant,
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
    return one.pattern === other.pattern && one.variant === other.variant && LogRange.equals(one.range, other.range);
  }
}

export namespace useLogFilter {
  export type Options = {
    parameters: URLSearchParams;
    setParameters: SetURLSearchParams;
  };

  export type Result = {
    /**
     * This value is memoized
     */
    activeFilter: Filter;
    isActiveFilterNarrowing: boolean;
    form: {
      pattern: string;
      setPattern: (value: string) => void;
      variant: LogPattern.Variant;
      toggleVariant: () => void;
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
    variant: LogPattern.Variant;
    range: LogRange.Value;
  };
  export function serialize(filter: Filter): LogService.FilterSubQuery {
    const { since, until } = LogRange.window(filter.range, Temporal.Now.instant());
    return {
      filterPattern: filter.pattern || undefined,
      // meaningless without something to read, and sending it alone would look like a filter
      filterPatternVariant: filter.pattern ? filter.variant : undefined,
      // stringified here rather than left to whatever the request builder does with an instant
      filterSince: since?.toString(),
      filterUntil: until?.toString(),
    };
  }
}
