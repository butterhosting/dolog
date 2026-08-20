import { Anchor } from "@/models/Anchor";
import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { useRegistry } from "./basics/useRegistry";

export function useAnchor(): useAnchor.Result {
  const dialogClient = useRegistry(DialogClient);
  const [parameters, setParameters] = useSearchParams();

  const [anchor, setAnchor] = useState<Anchor | undefined>(
    Anchor.parse(Internal.getUrlParam(parameters)), //
  );

  // Read the URL once (above) and keep it in sync, going forward
  useEffect(() => {
    setParameters((previous) => {
      if (anchor) {
        return Internal.setUrlParam(previous, anchor.serialize());
      } else {
        return Internal.clearUrlParam(previous);
      }
    });
  }, [anchor]);

  return {
    anchor,
    async promptNavigation() {
      const instant = await dialogClient.promptTimestampNavigationDialog(anchor?.type === "timestamp" ? anchor.value : undefined);
      if (instant === "cancel") {
        return;
      }
      if (anchor?.type === "timestamp" && Temporal.Instant.compare(anchor.value, instant) === 0) {
        return;
      }
      setAnchor(Anchor.forTimestamp(instant));
    },
    toggle(eventId: string) {
      setAnchor((currentAnchor) => {
        if (currentAnchor?.type === "id" && currentAnchor.value === eventId) {
          return undefined;
        } else {
          return Anchor.forId(eventId);
        }
      });
    },
    clear() {
      setAnchor(undefined);
    },
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
    promptNavigation(): Promise<void>;
    toggle(eventId: string): void;
    clear(): void;
  };
}
