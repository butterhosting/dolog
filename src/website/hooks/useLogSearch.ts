import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { LogPattern } from "@/models/LogPattern";
import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogClient } from "../clients/LogClient";
import { LogControls } from "../comps/logviewer/LogControls";
import { LogRow } from "../comps/logviewer/LogRow";
import { LogMatches } from "../models/LogMatches";
import { useLogFilter } from "./useLogFilter";
import { useRegistry } from "./useRegistry";

/**
 * Find, which is a different act from filtering: it moves the reader through the log rather than
 * re-defining what the log is. It therefore holds almost no state -- what it knows is what is on
 * screen at the moment a chevron is pressed, and it asks the server for the rest.
 */
export function useLogSearch({
  id,
  applied,
  scrollWindowRef,
  rendered,
  events,
  onFoundOutsideWindow,
}: useLogSearch.Options): useLogSearch.Result {
  const logClient = useRegistry(LogClient);

  const [needle, setNeedle] = useState("");
  const [variant, setVariant] = useState<LogPattern.Variant>(LogPattern.Variant.substr);
  /**
   * The match last stepped to. The only state search keeps, and it cannot go stale: every step
   * re-checks it against the viewport and drops it the moment it is not on screen, so it can never
   * pull the reader back to somewhere they have scrolled away from.
   */
  const [currentMatch, setCurrentMatch] = useState<string | null>(null);
  /** Which way, not merely whether -- so the chevron that was not pressed keeps still. */
  const [searching, setSearching] = useState<Direction | null>(null);
  /** So "there is nothing that way" can be said by the control that was asked. */
  const chevrons = {
    [Direction.backwards_in_time]: useRef<HTMLButtonElement>(null),
    [Direction.forwards_in_time]: useRef<HTMLButtonElement>(null),
  };
  const [finding, setFinding] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const toggleVariant = useCallback(() => {
    setVariant((current) => (current === LogPattern.Variant.regex ? LogPattern.Variant.substr : LogPattern.Variant.regex));
  }, []);

  /**
   * Closing takes the needle with it. The highlights are the search made visible, so leaving them
   * behind would mean a closed control still marking up the log -- with nothing on screen left to
   * explain why, or to clear them with.
   */
  const close = useCallback(() => {
    setFinding(false);
    setNeedle("");
    setCurrentMatch(null);
  }, []);

  /**
   * The browser's own find is worse than useless here: it only sees the lines currently in the dom,
   * so it answers "not found" for a line that is merely further up the log. Taking the shortcut is a
   * service rather than a theft -- it does what the reader meant.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "f" || event.key === "k")) {
        event.preventDefault();
        setFinding(true);
        field.current?.select();
        field.current?.focus();
      }
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  /** Which of the loaded lines the needle lights up, and whether it is even a usable needle yet. */
  const { matched, broken } = useMemo(() => LogMatches.highlight(events, needle, variant), [events, needle, variant]);

  // a different needle makes the old match meaningless
  useEffect(() => {
    setCurrentMatch(null);
  }, [needle, variant]);

  /**
   * One step through the matches, in one direction.
   *
   * Where it starts from is decided here and nowhere else, from what is on screen at the moment the
   * chevron is pressed. A match still in view is where the reader is, so the next one is taken from
   * there. Once it has been scrolled away from it stops counting, and the far edge of the viewport
   * takes over -- which is what stops a match left far above from dragging them back to it.
   *
   * The edge line is included in the search because it has every right to match; a match being
   * stepped off is not, or it would answer with itself forever.
   */
  const step = useCallback(
    async (direction: Direction) => {
      const container = scrollWindowRef.current;
      const term = needle.trim();
      if (!container || !term || searching !== null) {
        return;
      }
      const onMatch = currentMatch !== null && LogRow.onScreen(container, currentMatch);
      const edges = onMatch ? {} : LogRow.visibleEdges(container);
      const from = onMatch ? currentMatch : direction === Direction.backwards_in_time ? edges.last : edges.first;

      setSearching(direction);
      try {
        const found = await logClient.find(id, {
          searchPattern: term,
          searchPatternVariant: variant,
          ...(onMatch ? { anchorExclusive: from } : { anchorInclusive: from }),
          direction,
          // the corpus the search happens inside, so it never lands on a line the view hides
          ...useLogFilter.serialize(applied),
        });
        if (!found) {
          // deliberately no wrapping: in a log of unknown length, silently reappearing at the other
          // end reads as having lost your place rather than as having run out
          LogControls.nudge(chevrons[direction].current);
          return;
        }
        setCurrentMatch(found);
        if (rendered.current.some((event) => event.id === found)) {
          /**
           * Only move the view for an answer the reader cannot already see. Recentring on a match
           * that was on screen the whole time shifts everything around it for no gain -- they were
           * reading that page, and the highlight moving is the whole of the news.
           */
          if (!LogRow.onScreen(container, found)) {
            LogRow.element(container, found)?.scrollIntoView({ block: "center" });
          }
          return;
        }
        // the match is outside the window, so the window has to move to it
        onFoundOutsideWindow(found);
      } finally {
        setSearching(null);
      }
    },
    [applied, logClient, currentMatch, id, needle, scrollWindowRef, rendered, variant, searching, onFoundOutsideWindow],
  );

  return {
    finding,
    close,
    field,
    needle,
    setNeedle,
    variant,
    toggleVariant,
    matched,
    broken,
    currentMatch,
    searching,
    chevrons,
    step,
  };
}

export namespace useLogSearch {
  export type Options = {
    id: string;
    /** The corpus the search happens inside, so it never lands on a line the view hides. */
    applied: useLogFilter.Filter;
    /** The scrolling log, which is what "on screen" is measured against. */
    scrollWindowRef: RefObject<HTMLElement | null>;
    /** The lines currently held, read at press time rather than closed over. */
    rendered: RefObject<ContainerEvent[]>;
    /** The same lines as state, since the highlights have to be recomputed when they change. */
    events: ContainerEvent[];
    /** Asked to move the window when the answer is a line that is not in it. */
    onFoundOutsideWindow: (lineId: string) => void;
  };

  export type Result = {
    /** Whether the find bar is up at all. */
    finding: boolean;
    close: () => void;
    field: RefObject<HTMLInputElement | null>;
    needle: string;
    setNeedle: (value: string) => void;
    variant: LogPattern.Variant;
    toggleVariant: () => void;
    /** Ids of the loaded lines the needle lights up. */
    matched: Set<string>;
    /** Whether the needle is not yet a usable pattern, which the field says by colouring itself. */
    broken: boolean;
    currentMatch: string | null;
    searching: Direction | null;
    chevrons: Record<Direction, RefObject<HTMLButtonElement | null>>;
    step: (direction: Direction) => Promise<void>;
  };
}
