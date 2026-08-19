import { LogService } from "@/services/LogService";
import { Temporal } from "@js-temporal/polyfill";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { LogRange } from "../models/LogRange";
import { useRegistry } from "./useRegistry";
import { Filter } from "@/models/Filter";

export function useLogFilter(): useLogFilter.Result {
  const dialogClient = useRegistry(DialogClient);
  const [parameters, setParameters] = useSearchParams();

  const key = Internal.PARAMS.map((param) => parameters.get(param) || "").join(" ");
  const filter = useMemo(() => Internal.parseFilter(parameters), [key]);

  // form
  const [pattern, setPattern] = useState(filter.pattern);
  const [patternType, setPatternType] = useState<Filter.Pattern.Type>(filter.patternVariant);
  const [range, setRange] = useState<LogRange.Value>(filter.range);
  const dirty = !Internal.equals(filter, {
    pattern: pattern.trim(),
    patternVariant: patternType,
    range,
  });

  function togglePatternVariant() {
    setPatternType((current) => {
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
    setParameters((previous) => Internal.merge(previous, { pattern: pattern.trim(), patternVariant: patternType, range }));
  }

  return {
    filter,
    isFilterNarrowing: Internal.isNarrowing(filter),
    form: { pattern, setPattern, patternVariant: patternType, togglePatternVariant, range, promptRangeDialog },
    formState: { dirty, apply },
  };
}

namespace Internal {
  export const PARAMS: string[] = [...Object.values(LogService.FilterKey), LogRange.PARAM];

  export function parseFilter(parameters: URLSearchParams): useLogFilter.ClientFilter {
    return {
      pattern: parameters.get(LogService.FilterKey.filterPattern) ?? "",
      patternVariant:
        parameters.get(LogService.FilterKey.filterPatternType) === "regex" ? LogPattern.Variant.regex : LogPattern.Variant.substr,
      range: LogRange.fromParams(parameters),
    };
  }

  export function merge(previous: URLSearchParams, filter: useLogFilter.ClientFilter): URLSearchParams {
    const next = new URLSearchParams(previous);
    // clear the params of all existing filter-related params
    PARAMS.forEach((param) => next.delete(param));
    // insert the new filter params
    const filterParams = {
      ...(filter.pattern
        ? {
            [LogService.FilterKey.filterPattern]: filter.pattern,
            [LogService.FilterKey.filterPatternType]: filter.patternVariant,
          }
        : {}),
      ...LogRange.toParams(filter.range),
    };
    Object.entries(filterParams).forEach(([param, value]) => next.set(param, value));
    return next;
  }

  export function isNarrowing(applied: useLogFilter.ClientFilter): boolean {
    return applied.pattern !== "" || !LogRange.isAll(applied.range);
  }

  export function equals(one: useLogFilter.ClientFilter, other: useLogFilter.ClientFilter): boolean {
    return one.pattern === other.pattern && one.patternVariant === other.patternVariant && LogRange.equals(one.range, other.range);
  }
}

export namespace useLogFilter {
  export type Result = {
    /**
     * This value is memoized
     */
    filter: ClientFilter;
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

  export type ClientFilter = Filter & {
    preset?: "all" | "last10m" | "last30m" | "last1h" | "last24h" | "last7d" | "last30d" | "today" | "yesterday";
  };
  export function serialize(filter: ClientFilter): LogService.FilterSubQuery {
    // TODO ... ugly!
    const { since, until } = filter.preset ? LogRange.preset(filter.preset).window(Temporal.Now.instant()) : filter;
    return {
      filterPattern: filter.pattern?.value,
      filterPatternType: filter.pattern?.type,
      filterSince: since?.toString(),
      filterUntil: until?.toString(),
    };
  }
}
