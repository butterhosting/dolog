import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Pattern } from "@/models/Pattern";
import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogClient } from "../clients/LogClient";
import { LogControls } from "../comps/LogControls";
import { ClientFilter } from "./objects/ClientFilter";
import { PhysicalDOMContainer } from "./objects/PhysicalDOMContainer";
import { useLogFilter } from "./useLogFilter";
import { useRegistry } from "./useRegistry";

/**
 * Find, which is a different act from filtering: it moves the reader through the log rather than
 * re-defining what the log is. It therefore holds almost no state -- what it knows is what is on
 * screen at the moment a chevron is pressed, and it asks the server for the rest.
 */
export function useLogSearch({
  containerId,
  filter,
  physicalDOMContainer,
  events,
  onFoundOutsideWindow,
}: useLogSearch.Options): useLogSearch.Result {
  const logClient = useRegistry(LogClient);

  const [needle, setNeedle] = useState("");
  const [patternType, setPatternType] = useState<Pattern.Type>(Pattern.Type.substr);
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

  function togglePatternType() {
    setPatternType((current) => (current === Pattern.Type.regex ? Pattern.Type.substr : Pattern.Type.regex));
  }

  /**
   * Closing takes the needle with it. The highlights are the search made visible, so leaving them
   * behind would mean a closed control still marking up the log -- with nothing on screen left to
   * explain why, or to clear them with.
   *
   * Memoized because the keydown effect below depends on it, and a fresh one every render would
   * tear down and re-register the window listener every render.
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
  const { matched, broken } = useMemo(() => Internal.highlight(events, needle, patternType), [events, needle, patternType]);

  // a different needle makes the old match meaningless
  useEffect(() => {
    setCurrentMatch(null);
  }, [needle, patternType]);

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
  async function step(direction: Direction) {
    const value = needle.trim();
    if (!value || searching !== null) {
      return;
    }
    const onMatch = currentMatch !== null && physicalDOMContainer.events.isVisible(currentMatch);
    const edges = onMatch ? {} : physicalDOMContainer.events.outermostVisibleIds();
    const from = onMatch ? currentMatch : direction === Direction.forwards_in_time ? edges.oldest : edges.newest;

    setSearching(direction);
    try {
      const found = await logClient.find(containerId, {
        searchPattern: value,
        searchPatternType: patternType,
        ...(onMatch ? { anchorExclusive: from } : { anchorInclusive: from }),
        direction,
        // the corpus the search happens inside, so it never lands on a line the view hides
        ...useLogFilter.serializeForServer(filter),
      });
      if (!found) {
        // deliberately no wrapping: in a log of unknown length, silently reappearing at the other
        // end reads as having lost your place rather than as having run out
        LogControls.nudge(chevrons[direction].current);
        return;
      }
      setCurrentMatch(found);
      /**
       * Asked of the dom rather than of a copy of the window, because the very next thing done with
       * the answer is to scroll to that line: one the list holds but has not painted yet is not one
       * that can be scrolled to.
       */
      if (physicalDOMContainer.events.exists(found)) {
        /**
         * Only move the view for an answer the reader cannot already see. Recentring on a match that
         * was on screen the whole time shifts everything around it for no gain -- they were reading
         * that page, and the highlight moving is the whole of the news.
         */
        if (!physicalDOMContainer.events.isVisible(found)) {
          physicalDOMContainer.move.toEvent(found);
        }
        return;
      }
      // the match is outside the window, so the window has to move to it
      onFoundOutsideWindow(found);
    } finally {
      setSearching(null);
    }
  }

  return {
    finding,
    close,
    field,
    needle,
    setNeedle,
    patternType,
    togglePatternType,
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
    containerId: string;
    filter: ClientFilter;
    physicalDOMContainer: PhysicalDOMContainer;
    events: ContainerEvent[];
    onFoundOutsideWindow: (eventId: string) => void;
  };

  export type Result = {
    finding: boolean;
    close: () => void;
    field: RefObject<HTMLInputElement | null>;
    needle: string;
    setNeedle: (value: string) => void;
    patternType: Pattern.Type;
    togglePatternType: () => void;
    matched: Set<string>;
    broken: boolean;
    currentMatch: string | null;
    searching: Direction | null;
    chevrons: Record<Direction, RefObject<HTMLButtonElement | null>>;
    step: (direction: Direction) => Promise<void>;
  };
}

namespace Internal {
  /**
   * Which of the loaded lines the needle lights up. Only ever a claim about what is in hand --
   * stepping is what asks the server about the lines that are not.
   */
  export function highlight(events: ContainerEvent[], needle: string, type: Pattern.Type): { matched: Set<string>; broken: boolean } {
    const value = needle.trim();
    if (!value) {
      return { matched: new Set(), broken: false };
    }
    try {
      const matches = Pattern.createPredicate({ type, value });
      return {
        matched: new Set(events.filter((event) => event.type === ContainerEvent.Type.log && matches(event.line)).map((event) => event.id)),
        broken: false,
      };
    } catch {
      // half way through typing an expression, which is not yet an error worth shouting about
      return { matched: new Set(), broken: true };
    }
  }
}
