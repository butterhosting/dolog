import { LogAnchor } from "@/models/LogAnchor";
import { Temporal } from "@js-temporal/polyfill";
import { useState } from "react";
import type { SetURLSearchParams } from "react-router";

export function useLogAnchor({ parameters, setParameters }: useLogAnchor.Options): useLogAnchor.Result {
  const at = LogAnchor.parse(Internal.getUrlParam(parameters));
  const [anchor, setAnchor] = useState<LogAnchor | undefined>(at);

  function activateTimestampAnchor(instant: Temporal.Instant): ReturnType<useLogAnchor.Result["activateTimestampAnchor"]> {
    const instantValue = instant.toString();
    setParameters((previous) => Internal.setUrlParam(previous, instantValue));
    if (anchor?.type === "timestamp" && anchor.serialize() === instantValue) {
      return "did_not_have_to_navigate";
    }
    setAnchor(LogAnchor.forTimestamp(instant));
    return "did_navigate";
  }

  function toggleEventAnchor(eventId: string): ReturnType<useLogAnchor.Result["toggleEventAnchor"]> {
    if (at?.type === "id" && at.value === eventId) {
      setParameters(Internal.clearUrlParam, { replace: true });
      setAnchor(undefined);
      return "deactivated";
    }
    setParameters((previous) => Internal.setUrlParam(previous, eventId), { replace: true });
    setAnchor(LogAnchor.forId(eventId));
    return "activated";
  }

  function clearAnchor() {
    setParameters(Internal.clearUrlParam, { replace: true });
    setAnchor(undefined);
  }

  return {
    anchor,
    activateTimestampAnchor,
    toggleEventAnchor,
    clearAnchor,
  };
}

namespace Internal {
  const PARAM = "at";

  export function getUrlParam(params: URLSearchParams): string | undefined {
    return params.get(PARAM) || undefined;
  }
  export function setUrlParam(previous: URLSearchParams, at: string): URLSearchParams {
    const next = new URLSearchParams(previous);
    next.set(PARAM, at);
    return next;
  }
  export function clearUrlParam(previous: URLSearchParams): URLSearchParams {
    const next = new URLSearchParams(previous);
    next.delete(PARAM);
    return next;
  }
}

export namespace useLogAnchor {
  export type Options = {
    parameters: URLSearchParams;
    setParameters: SetURLSearchParams;
  };

  export type Result = {
    anchor?: LogAnchor;
    activateTimestampAnchor: (instant: Temporal.Instant) => "did_navigate" | "did_not_have_to_navigate";
    toggleEventAnchor: (eventId: string) => "activated" | "deactivated";
    clearAnchor: () => void;
  };
}
