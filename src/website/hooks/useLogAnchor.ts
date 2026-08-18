import { LogAnchor } from "@/models/LogAnchor";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { useRegistry } from "./useRegistry";

export function useLogAnchor(): useLogAnchor.Result {
  const dialogClient = useRegistry(DialogClient);
  const [parameters, setParameters] = useSearchParams();

  const at = LogAnchor.parse(Internal.getUrlParam(parameters));
  const [anchor, setAnchor] = useState<LogAnchor | undefined>(at);

  async function promptNavigation() {
    const instant = await dialogClient.promptTimestampNavigationDialog(anchor?.type === "timestamp" ? anchor.value : undefined);
    if (instant === "cancel") {
      return;
    }

    const instantValue = instant.toString();
    setParameters((previous) => Internal.setUrlParam(previous, instantValue));

    if (anchor?.type === "timestamp" && anchor.serialize() === instantValue) {
      return;
    }
    setAnchor(LogAnchor.forTimestamp(instant));
  }

  function toggleEvent(eventId: string) {
    if (at?.type === "id" && at.value === eventId) {
      setParameters(Internal.clearUrlParam, { replace: true });
      setAnchor(undefined);
    } else {
      setParameters((previous) => Internal.setUrlParam(previous, eventId), { replace: true });
      setAnchor(LogAnchor.forId(eventId));
    }
  }

  function clear() {
    setParameters(Internal.clearUrlParam, { replace: true });
    setAnchor(undefined);
  }

  return {
    anchor,
    promptNavigation: promptNavigation,
    toggleEvent,
    clear,
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
  export type Result = {
    anchor?: LogAnchor;
    promptNavigation: () => Promise<void>;
    toggleEvent: (eventId: string) => void;
    clear: () => void;
  };
}
