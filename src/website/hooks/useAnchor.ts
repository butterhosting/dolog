import { Anchor } from "@/models/Anchor";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { useRegistry } from "./basics/useRegistry";

export function useAnchor(): useAnchor.Result {
  const dialogClient = useRegistry(DialogClient);
  const [parameters, setParameters] = useSearchParams();

  const at = Anchor.parse(Internal.getUrlParam(parameters));
  const [anchor, setAnchor] = useState<Anchor | undefined>(at);

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
    setAnchor(Anchor.forTimestamp(instant));
  }

  function toggle(eventId: string) {
    if (at?.type === "id" && at.value === eventId) {
      setParameters(Internal.clearUrlParam, { replace: true });
      setAnchor(undefined);
    } else {
      setParameters((previous) => Internal.setUrlParam(previous, eventId), { replace: true });
      setAnchor(Anchor.forId(eventId));
    }
  }

  function clear() {
    setParameters(Internal.clearUrlParam, { replace: true });
    setAnchor(undefined);
  }

  return {
    anchor,
    promptNavigation: promptNavigation,
    toggle,
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

export namespace useAnchor {
  export type Result = {
    anchor?: Anchor;
    promptNavigation: () => Promise<void>;
    toggle: (eventId: string) => void;
    clear: () => void;
  };
}
