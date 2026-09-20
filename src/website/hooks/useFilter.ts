import { Timestamp } from "@/helpers/Timestamp";
import { Pattern } from "@/models/Pattern";
import { LogService } from "@/services/LogService";
import { Range } from "@/website/hooks/objects/Range";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { useRegistry } from "./basics/useRegistry";
import { ClientFilter } from "./objects/ClientFilter";

export function useFilter(): useFilter.Result {
  const dialogClient = useRegistry(DialogClient);
  const [parameters, setParameters] = useSearchParams();

  const [filter, setFilter] = useState(Internal.parseClientUrl(parameters));
  useEffect(() => {
    setParameters((previous) => Internal.mergeClientUrl(previous, filter), { replace: true });
  }, [filter]);

  // Form (initial values based on the URL, see above)
  const [pattern, setPattern] = useState(filter.pattern?.value ?? "");
  const [patternType, setPatternType] = useState<Pattern.Type>(filter.pattern?.type ?? Pattern.Type.substr);
  const [range, setRange] = useState<Range>(filter.range);

  const staged: ClientFilter = {
    pattern: pattern.trim()
      ? {
          type: patternType,
          value: pattern.trim(),
        }
      : undefined,
    range,
  };

  function commit(target = staged) {
    setFilter(target);
  }

  return {
    filter,
    isFilterNarrowing: Internal.isNarrowing(filter),
    form: {
      pattern,
      setPattern,
      patternType,
      togglePatternType() {
        setPatternType(Pattern.flipType);
      },
      range,
      async promptRangeDialog() {
        const newRange = await dialogClient.promptRangeDialog(range);
        if (newRange !== "cancel") {
          setRange(newRange);
          commit({ ...staged, range: newRange });
        }
      },
    },
    formState: {
      dirty: !Internal.equals(filter, staged),
      apply() {
        commit();
      },
    },
  };
}

namespace Internal {
  enum ClientUrlParam {
    pattern = "pattern",
    patternType = "patternType",
    range = "range",
    rangePreset = "rangePreset",
    rangeSince = "rangeSince",
    rangeUntil = "rangeUntil",
  }

  export function hash(parameters: URLSearchParams): string {
    return Object.values(ClientUrlParam)
      .map((param) => parameters.get(param) || "")
      .join(" ");
  }

  export function parseClientUrl(parameters: URLSearchParams): ClientFilter {
    const patternType = (parameters.get(ClientUrlParam.patternType) ?? undefined) as Pattern.Type;
    const patternValue = parameters.get(ClientUrlParam.pattern) ?? undefined;
    const rangeType = (parameters.get(ClientUrlParam.range) ?? undefined) as Range.Type;
    const rangePreset = (parameters.get(ClientUrlParam.rangePreset) ?? undefined) as Range.Preset;
    const rangeSince = parameters.get(ClientUrlParam.rangeSince) ?? undefined;
    const rangeUntil = parameters.get(ClientUrlParam.rangeUntil) ?? undefined;

    let pattern: Pattern | undefined = undefined;
    if (Object.values(Pattern.Type).includes(patternType) && patternValue) {
      pattern = {
        type: patternType,
        value: patternValue,
      };
    }

    let range: Range = Range.forPreset(Range.Preset.last30d);
    if (Object.values(Range.Type).includes(rangeType)) {
      switch (rangeType) {
        case Range.Type.preset: {
          if (Object.values(Range.Preset).includes(rangePreset)) {
            range = Range.forPreset(rangePreset);
          }
          break;
        }
        case Range.Type.custom: {
          range = Range.forCustom({
            since: Timestamp.tryInstant(rangeSince),
            until: Timestamp.tryInstant(rangeUntil),
          });
          break;
        }
        default: {
          rangeType satisfies never;
        }
      }
    }

    return { pattern, range };
  }

  export function mergeClientUrl(previous: URLSearchParams, filter: ClientFilter): URLSearchParams {
    const next = new URLSearchParams(previous);

    // clear the params of all existing filter-related params
    Object.values(ClientUrlParam).forEach((param) => next.delete(param));

    // insert the new filter params
    const params: Record<string, string | undefined> = {};
    if (filter.pattern) {
      params[ClientUrlParam.pattern] = filter.pattern.value;
      params[ClientUrlParam.patternType] = filter.pattern.type;
    }
    params[ClientUrlParam.range] = filter.range.type;
    switch (filter.range.type) {
      case "preset": {
        params[ClientUrlParam.rangePreset] = filter.range.preset;
        break;
      }
      case "custom": {
        params[ClientUrlParam.rangeSince] = filter.range.since?.toString();
        params[ClientUrlParam.rangeUntil] = filter.range.until?.toString();
        break;
      }
      default: {
        filter.range satisfies never;
      }
    }
    Object.entries(params).forEach(([param, value]) => {
      if (value) {
        next.set(param, value);
      }
    });
    return next;
  }

  export function isNarrowing(filter: ClientFilter): boolean {
    return Boolean(filter.pattern?.value) || !(filter.range.type === "preset" && filter.range.preset === Range.Preset.all);
  }

  export function equals(a: ClientFilter, b: ClientFilter): boolean {
    return a.pattern?.type === b.pattern?.type && a.pattern?.value === b.pattern?.value && Range.equals(a.range, b.range);
  }
}

export namespace useFilter {
  export type Result = {
    /**
     * This value is memoized
     */
    filter: ClientFilter;
    isFilterNarrowing: boolean;
    form: {
      pattern: string;
      setPattern: (value: string) => void;
      patternType: Pattern.Type;
      togglePatternType: () => void;
      range: Range;
      promptRangeDialog: () => Promise<void>;
    };
    formState: {
      dirty: boolean;
      apply: () => void;
    };
  };

  export function serializeForServer(clientFilter: ClientFilter, timezone: string): LogService.FilterSubQuery {
    const { since, until } = clientFilter.range.materialize(timezone);
    return {
      filterPattern: clientFilter.pattern?.value || undefined,
      filterPatternType: clientFilter.pattern?.type || undefined,
      filterSince: since?.toString(),
      filterUntil: until?.toString(),
    };
  }
}
