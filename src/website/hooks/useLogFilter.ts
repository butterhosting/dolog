import { LogPattern } from "@/models/LogPattern";
import { LogService } from "@/services/LogService";
import { Temporal } from "@js-temporal/polyfill";
import { useCallback, useMemo, useState } from "react";
import type { SetURLSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { LogRange } from "../models/LogRange";
import { useRegistry } from "./useRegistry";

export function useLogFilter({ parameters, setParameters, pinnedAt }: useLogFilter.Options): useLogFilter.Result {
  const dialogClient = useRegistry(DialogClient);

  const key = Object.values(LogService.FilterKey)
    .map((param) => parameters.get(param) || "")
    .join(" ");

  const activeFilter = useMemo(() => Internal.toFilter(parameters), [key]);

  // the filter being composed, which is only the filter in force once Apply says so
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

  /**
   * Writes the filter into the url and stops there. A marker already on screen is carried over,
   * because a filter re-defines what the window *is* but not where the reader is standing in it --
   * moving them is the window's business, and the page asks for it separately.
   */
  const apply = useCallback(() => {
    setParameters(Internal.toParams({ pattern: pattern.trim(), variant, range }, pinnedAt));
  }, [pattern, variant, range, pinnedAt, setParameters]);

  return {
    key,
    activeFilter,
    isActiveFilterNarrowing: Internal.isNarrowing(activeFilter),
    form: { pattern, setPattern, variant, toggleVariant, range, promptRangeDialog },
    formState: { dirty, apply },
  };
}

namespace Internal {
  export function toFilter(parameters: URLSearchParams): useLogFilter.Filter {
    return {
      pattern: parameters.get("filter") ?? "",
      variant: parameters.get("filterVariant") === "regex" ? LogPattern.Variant.regex : LogPattern.Variant.substr,
      range: LogRange.fromParams(parameters),
    };
  }

  export function toParams(applied: useLogFilter.Filter, pinnedAt: string | null): Record<string, string> {
    return {
      ...(pinnedAt ? { at: pinnedAt } : {}),
      ...(applied.pattern ? { filter: applied.pattern, filterVariant: applied.variant } : {}),
      ...LogRange.toParams(applied.range),
    };
  }

  // Whether anything is being narrowed at all, which changes what an empty window means
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
    pinnedAt: string | null;
  };

  export type Result = {
    key: string; // hash of the applied filter (for triggering reloads, etc)
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

  export function toRequest(applied: Filter): LogService.FilterSubQuery {
    const { since, until } = LogRange.window(applied.range, Temporal.Now.instant());
    return {
      filterPattern: applied.pattern || undefined,
      // meaningless without something to read, and sending it alone would look like a filter
      filterPatternVariant: applied.pattern ? applied.variant : undefined,
      filterSince: since,
      filterUntil: until,
    };
  }
}
