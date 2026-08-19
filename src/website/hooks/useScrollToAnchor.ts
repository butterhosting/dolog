import { LogAnchor } from "@/models/LogAnchor";
import { RefObject, useEffect, useRef } from "react";
import { LogRow } from "../comps/logs/LogRow";
import { Line } from "../rendering/Line";

/**
 * Puts the view on the line a navigation asked for, once there is something to put it on.
 *
 * Waits for `showsWhatWasAskedFor`, and that is the whole subtlety here. Asking for an anchor and
 * receiving its window are two different moments, and in between the *previous* window is still
 * drawn -- so the line looks absent, this scrolls to the end of the log instead, and marks the
 * anchor as dealt with. The correct scroll then never happens, because it looks like it already did.
 */
export function useScrollToEvent({ scrollWindowRef, anchor, showsWhatWasAskedFor, loading, lines }: useScrollToEvent.Options) {
  const lastScrolledTo = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (anchor === undefined || loading || !showsWhatWasAskedFor || lines.length === 0) {
      return;
    }
    if (lastScrolledTo.current === anchor.serialize()) {
      return;
    }

    const scrollWindow = scrollWindowRef.current;
    if (!scrollWindow) {
      return;
    }
    lastScrolledTo.current = anchor.serialize();

    // an id names a line outright; an instant is answered by whichever line the server landed on
    const element = anchor?.type === "id" ? LogRow.element(scrollWindow, anchor.value) : LogRow.landed(scrollWindow);
    if (element) {
      element.scrollIntoView({ block: "center" });
      return;
    }
    // nothing was drawn for it, so what the reader was given instead is the end of history
    scrollWindow.scrollTop = scrollWindow.scrollHeight;
  }, [anchor, showsWhatWasAskedFor, loading, lines, scrollWindowRef]);
}

export namespace useScrollToEvent {
  export type Options = {
    scrollWindowRef: RefObject<HTMLElement | null>;
    /** Which line the window was opened around: an event id, or an instant. */
    anchor?: LogAnchor;
    /** Whether the lines below are the ones this anchor asked for, rather than the previous window. */
    showsWhatWasAskedFor: boolean;
    loading: boolean;
    lines: Line[];
  };
}
