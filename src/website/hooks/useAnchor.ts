import { Anchor } from "@/models/Anchor";
import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useRef, useState } from "react";
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
    setParameters(
      (previous) => {
        if (anchor) {
          return Internal.setUrlParam(previous, anchor.serialize());
        } else {
          return Internal.clearUrlParam(previous);
        }
      },
      { replace: true },
    );
  }, [anchor]);

  const isDialogOpen = useRef(false);
  async function promptNavigation() {
    if (isDialogOpen.current) {
      return;
    }
    isDialogOpen.current = true;
    const instant = await dialogClient
      .promptTimestampNavigationDialog(anchor?.type === "timestamp" ? anchor.value : undefined)
      .finally(() => {
        isDialogOpen.current = false;
      });
    if (instant === "cancel") {
      return;
    }
    if (anchor?.type === "timestamp" && Temporal.Instant.compare(anchor.value, instant) === 0) {
      return;
    }
    setAnchor(Anchor.forTimestamp(instant));
  }

  //
  // Effect for binding the shortcut key that opens the navigation dialog
  //
  useEffect(() => {
    // TODO: pressing CMD+I repeatedly keeps opening modals on top of eachother
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "i") {
        event.preventDefault();
        void promptNavigation();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchor]);

  return {
    anchor,
    promptNavigation,
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
