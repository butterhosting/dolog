import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Pattern } from "@/models/Pattern";
import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import { LogClient } from "../clients/LogClient";
import { LogControls } from "../comps/LogControls";
import { useRegistry } from "./basics/useRegistry";
import { ClientFilter } from "./objects/ClientFilter";
import { LogsContainerNode } from "./objects/LogsContainerNode";
import { useFilter } from "./useFilter";

export function useSearch({
  containerId,
  logsContainerNode,
  filter,
  events,
  navigateToUnloadedMatchResult,
}: useSearch.Options): useSearch.Result {
  const logClient = useRegistry(LogClient);

  const [needle, setNeedle] = useState("");
  const [needleType, setNeedleType] = useState<Pattern.Type>(Pattern.Type.substr);
  const toggleNeedleType = () => setNeedleType(Pattern.flipType);
  const pattern = useMemo<Pattern>(
    () => ({ type: needleType, value: needle }), //
    [needleType, needle],
  );

  const [currentMatchId, setCurrentMatchId] = useState<string>();
  const [isSearchingRightNow, setSearchingRightNow] = useState<Direction>();

  const textField = useRef<HTMLInputElement>(null);
  const chevrons = {
    [Direction.backwards_in_time]: useRef<HTMLButtonElement>(null),
    [Direction.forwards_in_time]: useRef<HTMLButtonElement>(null),
  };

  const [activated, setActivated] = useState(false);
  function activate() {
    setActivated(true);
    textField.current?.select();
    textField.current?.focus();
  }
  function deactivate() {
    setActivated(false);
    setNeedle("");
    setCurrentMatchId(undefined);
  }

  //
  // Effect for binding shortcut keys to the search box
  //
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "f" || event.key === "k")) {
        event.preventDefault();
        activate();
      }
      if (event.key === "Escape") {
        deactivate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  //
  // Effect for purging the current match when the pattern changes
  //
  useEffect(() => {
    setCurrentMatchId(undefined);
  }, [pattern]);

  /**
   * Steps to the next/previous matching line
   */
  async function step(direction: Direction) {
    if (!pattern.value) {
      return;
    }
    if (isSearchingRightNow) {
      return;
    }

    let cursor: string | undefined;

    const isCurrentMatchVisible = Boolean(currentMatchId && logsContainerNode.events.isVisible(currentMatchId));
    if (isCurrentMatchVisible) {
      cursor = currentMatchId!;
    } else {
      const { topOfScreenId, bottomOfScreenId } = logsContainerNode.events.outermostVisibleIds();
      cursor = direction === Direction.forwards_in_time ? topOfScreenId : bottomOfScreenId;
    }

    setSearchingRightNow(direction);
    try {
      const nextMatchId = await logClient.find(containerId, {
        searchPattern: pattern.value,
        searchPatternType: pattern.type,
        ...(isCurrentMatchVisible ? { anchorExclusive: cursor } : { anchorInclusive: cursor }),
        direction,
        ...useFilter.serializeForServer(filter),
      });

      if (!nextMatchId) {
        LogControls.nudge(chevrons[direction].current);
        return;
      }
      setCurrentMatchId(nextMatchId);

      if (logsContainerNode.events.exists(nextMatchId)) {
        if (!logsContainerNode.events.isVisible(nextMatchId)) {
          logsContainerNode.move.toEvent(nextMatchId);
        }
      } else {
        navigateToUnloadedMatchResult(nextMatchId);
      }
    } finally {
      setSearchingRightNow(undefined);
    }
  }

  const { matchedIds, isRegexInvalid } = useMemo(
    () => Internal.match(events, pattern), //
    [events, pattern],
  );

  return {
    activated,
    activate,
    deactivate,
    form: {
      textField,
      needle,
      setNeedle,
      needleType,
      toggleNeedleType,
      isRegexInvalid,
    },
    matching: {
      ids: matchedIds,
      currentId: currentMatchId,
      isSearchingRightNow,
      chevrons,
      step,
    },
  };
}

export namespace useSearch {
  export type Options = {
    containerId: string;
    logsContainerNode: LogsContainerNode;
    filter: ClientFilter;
    events: ContainerEvent[];
    navigateToUnloadedMatchResult: (eventId: string) => void;
  };

  export type Result = {
    activated: boolean;
    activate: () => void;
    deactivate: () => void;
    form: {
      textField: RefObject<HTMLInputElement | null>;
      needle: string;
      setNeedle: (value: string) => void;
      needleType: Pattern.Type;
      toggleNeedleType: () => void;
      isRegexInvalid: boolean;
    };
    matching: {
      ids: Set<string>;
      currentId?: string;
      isSearchingRightNow?: Direction;
      chevrons: Record<Direction, RefObject<HTMLButtonElement | null>>;
      step: (direction: Direction) => Promise<void>;
    };
  };
}

namespace Internal {
  export function match(events: ContainerEvent[], pattern: Pattern): { matchedIds: Set<string>; isRegexInvalid: boolean } {
    if (!pattern.value) {
      return {
        matchedIds: new Set(),
        isRegexInvalid: false,
      };
    }
    try {
      const matches = Pattern.createPredicate(pattern);
      return {
        matchedIds: new Set(
          events.filter((event) => event.type === ContainerEvent.Type.log && matches(event.line)).map((event) => event.id),
        ),
        isRegexInvalid: false,
      };
    } catch {
      // half way through typing an expression
      return {
        matchedIds: new Set(),
        isRegexInvalid: true,
      };
    }
  }
}
