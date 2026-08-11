import { LogPattern } from "@/models/LogPattern";
import { useCallback, useMemo, useState } from "react";
import type { SetURLSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { LogFilter } from "../models/LogFilter";
import { LogRange } from "../models/LogRange";
import { useRegistry } from "./useRegistry";

export function useLogFilter({ parameters, setParameters, pinnedAt }: useLogFilter.Options): useLogFilter.Result {
  const dialogClient = useRegistry(DialogClient);

  const key = LogFilter.key(parameters);
  /**
   * Memoised on the key rather than on `parameters`, so it holds its identity for as long as the
   * filter itself is unchanged -- `parameters` also carries the marker, and a dismissed marker must
   * not look like a new filter. The key is built from exactly the parameters read here, so the two
   * cannot disagree, and everything downstream can depend on this object instead of on a string
   * standing in for it.
   */
  const applied = useMemo(() => LogFilter.from(parameters), [key]);

  // the filter being composed, which is only the filter in force once Apply says so
  const [pattern, setPattern] = useState(applied.pattern);
  const [variant, setVariant] = useState<LogPattern.Variant>(applied.variant);
  const [range, setRange] = useState<LogRange.Value>(applied.range);

  const composed = { pattern: pattern.trim(), variant, range };
  const dirty = !LogFilter.equals(composed, applied);

  const toggleVariant = useCallback(() => {
    setVariant((current) => (current === LogPattern.Variant.regex ? LogPattern.Variant.substr : LogPattern.Variant.regex));
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
    setParameters(LogFilter.toParams({ pattern: pattern.trim(), variant, range }, pinnedAt));
  }, [pattern, variant, range, pinnedAt, setParameters]);

  return {
    key,
    applied,
    narrows: LogFilter.narrows(applied),
    form: { pattern, setPattern, variant, toggleVariant, range, promptRangeDialog },
    formState: { dirty, apply },
  };
}

export namespace useLogFilter {
  export type Options = {
    parameters: URLSearchParams;
    setParameters: SetURLSearchParams;
    pinnedAt: string | null;
  };

  export type Result = {
    key: string; // hash of the applied filter (for triggering reloads, etc)
    applied: LogFilter.Applied;
    narrows: boolean;
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
}
