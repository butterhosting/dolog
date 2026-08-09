import { LogPattern } from "@/models/LogPattern";
import { useCallback, useMemo, useState } from "react";
import type { SetURLSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { LogFilter } from "../models/LogFilter";
import { LogRange } from "../models/LogRange";
import { useRegistry } from "./useRegistry";

/**
 * The filter as the toolbar works it: what is in force, and what is being composed beside it.
 *
 * The two are kept apart because applying one re-defines the window. Unlike search, it therefore
 * waits for the button rather than following every keystroke.
 */
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

  const [draft, setDraft] = useState(applied.pattern);
  const [variant, setVariant] = useState<LogPattern.Variant>(applied.variant);
  const [range, setRange] = useState<LogRange.Value>(applied.range);

  const composed = { pattern: draft.trim(), variant, range };
  const dirty = !LogFilter.equals(composed, applied);

  const toggleVariant = useCallback(() => {
    setVariant((current) => (current === LogPattern.Variant.regex ? LogPattern.Variant.substr : LogPattern.Variant.regex));
  }, []);

  const openRange = useCallback(async () => {
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
    setParameters(LogFilter.toParams({ pattern: draft.trim(), variant, range }, pinnedAt));
  }, [draft, variant, range, pinnedAt, setParameters]);

  return {
    applied,
    key,
    narrows: LogFilter.narrows(applied),
    draft,
    setDraft,
    variant,
    toggleVariant,
    range,
    dirty,
    apply,
    openRange,
  };
}

export namespace useLogFilter {
  export type Options = {
    parameters: URLSearchParams;
    setParameters: SetURLSearchParams;
    /** The marker in the url, which an applied filter keeps rather than clears. */
    pinnedAt: string | null;
  };

  export type Result = {
    /** The filter in force. */
    applied: LogFilter.Applied;
    /** The same filter as a string, for the effects that must re-run when it changes and only then. */
    key: string;
    /** Whether anything is being narrowed at all, which changes what an empty window means. */
    narrows: boolean;
    draft: string;
    setDraft: (value: string) => void;
    variant: LogPattern.Variant;
    toggleVariant: () => void;
    range: LogRange.Value;
    /** Whether the draft differs from what is in force, which is when Apply is worth pressing. */
    dirty: boolean;
    apply: () => void;
    openRange: () => Promise<void>;
  };
}
