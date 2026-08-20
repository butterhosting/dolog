import { Timestamp } from "@/helpers/Timestamp";
import { Pattern } from "@/models/Pattern";
import { LogService } from "@/services/LogService";
import { Timespan } from "@/website/hooks/objects/Timespan";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { ClientFilter } from "./objects/ClientFilter";
import { useRegistry } from "./useRegistry";

export function useLogFilter(): useLogFilter.Result {
  const dialogClient = useRegistry(DialogClient);
  const [parameters, setParameters] = useSearchParams();

  const key = Internal.hash(parameters);
  const filter = useMemo(() => Internal.parseClientUrl(parameters), [key]);

  // form
  const [pattern, setPattern] = useState(filter.pattern?.value ?? "");
  const [patternType, setPatternType] = useState<Pattern.Type>(filter.pattern?.type ?? Pattern.Type.substr);
  const [timespan, setTimespan] = useState<Timespan>(filter.timespan);
  const dirty = !Internal.equals(filter, {
    pattern: pattern ? { type: patternType, value: pattern } : undefined,
    timespan,
  });

  function togglePatternType() {
    setPatternType((current) => {
      switch (current) {
        case Pattern.Type.regex:
          return Pattern.Type.substr;
        case Pattern.Type.substr:
          return Pattern.Type.regex;
      }
    });
  }

  async function promptTimespanDialog() {
    const chosen = await dialogClient.pickTimespan(timespan);
    if (chosen !== "cancel") {
      setTimespan(chosen);
    }
  }

  function apply() {
    // an empty box is no pattern at all, rather than a pattern that matches everything
    const trimmed = pattern.trim();
    setParameters((previous) =>
      Internal.mergeClientUrl(previous, { pattern: trimmed ? { type: patternType, value: trimmed } : undefined, timespan }),
    );
  }

  return {
    filter,
    isFilterNarrowing: Internal.isNarrowing(filter),
    form: { pattern, setPattern, patternType, togglePatternType, timespan, promptTimespanDialog },
    formState: { dirty, apply },
  };
}

namespace Internal {
  enum ClientUrlParam {
    pattern = "pattern",
    patternType = "patternType",
    timespan = "timespan",
    preset = "preset",
    since = "since",
    until = "until",
  }

  export function hash(parameters: URLSearchParams): string {
    return Object.values(ClientUrlParam)
      .map((param) => parameters.get(param) || "")
      .join(" ");
  }

  export function parseClientUrl(parameters: URLSearchParams): ClientFilter {
    const patternType = (parameters.get(ClientUrlParam.patternType) ?? undefined) as Pattern.Type;
    const patternValue = parameters.get(ClientUrlParam.pattern) ?? undefined;
    const timespanType = (parameters.get(ClientUrlParam.timespan) ?? undefined) as Timespan.Type;
    const timespanPreset = (parameters.get(ClientUrlParam.preset) ?? undefined) as Timespan.Preset;
    const timespanSince = parameters.get(ClientUrlParam.since) ?? undefined;
    const timespanUntil = parameters.get(ClientUrlParam.until) ?? undefined;

    let pattern: Pattern | undefined = undefined;
    if (Object.values(Pattern.Type).includes(patternType) && patternValue) {
      pattern = {
        type: patternType,
        value: patternValue,
      };
    }

    let timespan: Timespan = Timespan.forPreset(Timespan.Preset.last30d);
    if (Object.values(Timespan.Type).includes(timespanType)) {
      switch (timespanType) {
        case Timespan.Type.preset: {
          if (Object.values(Timespan.Preset).includes(timespanPreset)) {
            timespan = Timespan.forPreset(timespanPreset);
          }
          break;
        }
        case Timespan.Type.custom: {
          timespan = Timespan.forCustom({
            since: Timestamp.tryInstant(timespanSince),
            until: Timestamp.tryInstant(timespanUntil),
          });
          break;
        }
        default: {
          timespanType satisfies never;
        }
      }
    }

    return { pattern, timespan };
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
    params[ClientUrlParam.timespan] = filter.timespan.type;
    switch (filter.timespan.type) {
      case "preset": {
        params[ClientUrlParam.preset] = filter.timespan.preset;
        break;
      }
      case "custom": {
        params[ClientUrlParam.since] = filter.timespan.since?.toString();
        params[ClientUrlParam.until] = filter.timespan.until?.toString();
        break;
      }
      default: {
        filter.timespan satisfies never;
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
    return Boolean(filter.pattern?.value) || !(filter.timespan.type === "preset" && filter.timespan.preset === Timespan.Preset.all);
  }

  export function equals(a: ClientFilter, b: ClientFilter): boolean {
    return a.pattern?.type === b.pattern?.type && a.pattern?.value === b.pattern?.value && Timespan.equals(a.timespan, b.timespan);
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
      patternType: Pattern.Type;
      togglePatternType: () => void;
      timespan: Timespan;
      promptTimespanDialog: () => Promise<void>;
    };
    formState: {
      dirty: boolean;
      apply: () => void;
    };
  };

  export function serializeForServer(clientFilter: ClientFilter): LogService.FilterSubQuery {
    const { since, until } = clientFilter.timespan.materialize();
    return {
      filterPattern: clientFilter.pattern?.value || undefined,
      filterPatternType: clientFilter.pattern?.type || undefined,
      filterSince: since?.toString(),
      filterUntil: until?.toString(),
    };
  }
}
