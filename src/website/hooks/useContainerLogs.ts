import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { LogAnchor } from "@/models/LogAnchor";
import { ServerMessage } from "@/models/socket/ServerMessage";
import { Temporal } from "@js-temporal/polyfill";
import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { LogClient } from "../clients/LogClient";
import { SocketClient } from "../clients/SocketClient";
import { LogRow } from "../comps/logviewer/LogRow";
import { Line } from "../rendering/Line";
import { Renderer } from "../rendering/Renderer";
import { useLogFilter } from "./useLogFilter";
import { useRegistry } from "./useRegistry";
import { useStickyScrollWindow } from "./useStickyScrollWindow";

const LINES_PER_PAGE = 300;

/**
 * The window over a container's log: which lines are held, where in history it sits, and every way
 * of moving it. The live feed, paging in both directions, and the marker all belong here because
 * they are the same question asked from different ends -- what is on screen, and does the feed
 * still own the bottom of it.
 */
export function useContainerLogs({
  containerId,
  activeFilter,
  parameters,
  setParameters,
}: useContainerLogs.Options): useContainerLogs.Result {
  const logClient = useRegistry(LogClient);
  const socketClient = useRegistry(SocketClient);
  const dialogClient = useRegistry(DialogClient);
  const renderer = useRegistry(Renderer);

  const atParam = parameters.get(useContainerLogs.AT_PARAM) || undefined;

  const at = useMemo(() => LogAnchor.parse(atParam), [atParam]);
  const [anchor, setAnchor] = useState<LogAnchor | undefined>(at);
  const [loadedAnchor, setLoadedAnchor] = useState<LogAnchor>();

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<ContainerEvent[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [landedAt, setLandedAt] = useState<string>();
  const [reachesLiveFeed, setReachesLiveFeed] = useState(false);

  const { scrollWindowRef, atBottom, onScroll, scrollToBottom } = useStickyScrollWindow<HTMLDivElement>(events, !anchor);
  const isFollowingStreamRef = useRef(true);
  const hasMissedDataWhilePaused = useRef(false);

  const lines = useMemo(
    () => renderer.render({ events, hasOlder, hasNewer, at, landedAt }), //
    [events, hasOlder, hasNewer, at, landedAt],
  );

  //
  // Main effect to declare interest in the event stream, and manage incoming data
  // Note that stream interest is declared _before_ historic records are fetched
  //
  // This effect fires:
  //  - on page load
  //  - whenever the active filter changes
  //  - whenever somebody jumps around to a different anchor
  //
  useEffect(() => {
    let cancelled = false;
    let historyLoaded = false;
    const arrivedDuringFetch: ContainerEvent[] = [];

    setLoading(true);
    setEvents([]);

    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.log,
      callback: ({ data }) => {
        if (data.container.id !== containerId) {
          return;
        }
        if (!historyLoaded) {
          arrivedDuringFetch.push(data);
          return;
        }

        // Live lines are _only_ appended while the reader is tailing the end of the logs ...
        // ... otherwise they're discarded (to not grow the list from below)
        if (isFollowingStreamRef.current) {
          setEvents((current) => [...current, data].slice(-LINES_PER_PAGE));
        } else {
          hasMissedDataWhilePaused.current = true;
        }
      },
    });
    socketClient.declareStreamInterest(
      containerId,
      activeFilter.pattern
        ? {
            pattern: activeFilter.pattern,
            patternVariant: activeFilter.variant,
          }
        : null,
    );

    logClient
      .list(containerId, {
        limit: LINES_PER_PAGE,
        at: anchor ? LogAnchor.value(anchor) : undefined, // fetches either the latest logs, or logs _around_ the given anchor
        ...useLogFilter.serialize(activeFilter),
      })
      .then((page) => {
        if (cancelled) {
          return;
        }

        const combinedEvents = [...page.data];
        if (!anchor) {
          const fetchedIds = new Set(page.data.map((event) => event.id));
          const missedEvents = arrivedDuringFetch.filter((event) => !fetchedIds.has(event.id));
          combinedEvents.push(...missedEvents);
        }
        combinedEvents.splice(0, combinedEvents.length - LINES_PER_PAGE); // only keep the N latest events

        setEvents(combinedEvents);
        setLoadedAnchor(anchor);
        setLandedAt(page.landedAt);
        setHasOlder(page.hasOlder);
        setHasNewer(page.hasNewer);
        setReachesLiveFeed(page.reachesLiveFeed);
        setLoading(false);
        historyLoaded = true;

        if (!anchor) {
          requestAnimationFrame(() => scrollToBottom());
        }
      });

    return () => {
      cancelled = true;
      socketClient.declareStreamInterest(null);
      socketClient.unsubscribe(subscription);
    };
  }, [containerId, anchor, activeFilter, logClient, socketClient, scrollWindowRef, scrollToBottom]);

  //
  // Effect to automatically scroll the anchor into view
  //
  const lastScrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!anchor || loading || loadedAnchor !== anchor || lines.length === 0) {
      return;
    }

    const anchorValue = LogAnchor.value(anchor);
    if (lastScrolledTo.current === anchorValue) {
      return;
    }

    const scrollWindow = scrollWindowRef.current;
    const targetScrollElement = anchor.kind === "id" ? LogRow.element(scrollWindow, anchor.value) : LogRow.landed(scrollWindow);

    if (targetScrollElement) {
      lastScrolledTo.current = anchorValue;
      targetScrollElement.scrollIntoView({ block: "center" });
      return;
    }

    if (scrollWindow) {
      lastScrolledTo.current = anchorValue;
      scrollWindow.scrollTop = scrollWindow.scrollHeight;
    }
  }, [anchor, loadedAnchor, loading, lines, scrollWindowRef]);

  //
  // Loading function for `older` events
  // Prepending N new events will push the currently visible window down by N lines: hence the scroll correction
  //
  const isLoadingOlder = useRef(false);
  async function loadOlder() {
    const scrollWindow = scrollWindowRef.current;
    const oldest = events.at(0);
    if (!scrollWindow || !hasOlder || !oldest || isLoadingOlder.current) {
      return;
    }

    isLoadingOlder.current = true;
    const scrollHeightBefore = scrollWindow.scrollHeight;

    const page = await logClient.list(containerId, {
      limit: LINES_PER_PAGE,
      beforeExclusive: oldest.id,
      ...useLogFilter.serialize(activeFilter),
    });
    setHasOlder(page.hasOlder);
    setEvents((current) => [...page.data, ...current]);

    requestAnimationFrame(() => {
      scrollWindow.scrollTop += scrollWindow.scrollHeight - scrollHeightBefore;
      isLoadingOlder.current = false;
    });
  }

  //
  // Loading function for `newer` events
  // Slightly different, because appending new events at the bottom doesn't move the scroll position
  //
  const loadingNewer = useRef(false);
  async function loadNewer() {
    const newest = events.at(-1);
    if (!hasNewer || !newest || loadingNewer.current) {
      return;
    }

    loadingNewer.current = true;

    const page = await logClient.list(containerId, {
      limit: LINES_PER_PAGE,
      afterExclusive: newest.id,
      ...useLogFilter.serialize(activeFilter),
    });
    setHasNewer(page.hasNewer);
    setReachesLiveFeed(page.reachesLiveFeed);
    setEvents((current) => [...current, ...page.data]);

    loadingNewer.current = false;
  }

  //
  // Fetch the latest page and connect it with whatever events are currently loaded (if possible; they might be disjoint)
  // Runs when:
  //  - scrolling to the bottom
  //  - clicking the "jump to bottom" button
  //
  const eventsRef = useRef<ContainerEvent[]>([]);
  useEffect(() => void (eventsRef.current = events), [events]);
  async function catchupWithLatestEvents() {
    if (!hasMissedDataWhilePaused.current) {
      return;
    }

    hasMissedDataWhilePaused.current = false;
    const latestPage = await logClient.list(containerId, {
      limit: LINES_PER_PAGE,
      ...useLogFilter.serialize(activeFilter),
    });

    // based on the `eventsRef` because the `events` state object will have changed
    // by the time the network call above has returned (websocket), so `events` is unusable
    const currentlyLoadedEventIds = new Set(eventsRef.current.map((event) => event.id));
    const canThisLatestPageJoinTheCurrentlyLoadedEventsWithoutFabricatingContinuity = latestPage.data.some((event) => {
      return currentlyLoadedEventIds.has(event.id);
    });

    if (canThisLatestPageJoinTheCurrentlyLoadedEventsWithoutFabricatingContinuity) {
      // merge both windows, because there's continuity
      const merged = ContainerEvent.deduplicate([...eventsRef.current, ...latestPage.data]).sort(
        ContainerEvent.sort(Direction.forwards_in_time),
      );
      setEvents(merged);
    } else {
      // replace the window with the latest data, because it's disjoint
      setEvents(latestPage.data);
      setHasOlder(latestPage.hasOlder);
    }
  }

  //
  // Effect which checks if we should begin appending new logs as they come in (follow the stream)
  //
  const isFollowingStream = atBottom && reachesLiveFeed && !anchor;
  useEffect(() => {
    isFollowingStreamRef.current = isFollowingStream; // this will "follow the stream"
    if (isFollowingStream) {
      void catchupWithLatestEvents();
    }
  }, [isFollowingStream]);

  function abandonCurrentWindow() {
    setAnchor(undefined); // remove the anchor (most important update)
    setHasNewer(false);
    setReachesLiveFeed(false); // the new window has not answered yet, so nothing may be appended to the old one meanwhile
  }

  /**
   * A filter has just been applied, which re-fetches on its own -- the load effect watches the
   * filter. What it cannot decide is *where* to land, and that is this rule: a reader holding a
   * marker keeps their place, because the marker is the whole reason they are parked there. Anyone
   * else goes back to the live end, the window they were reading having described the old filter.
   *
   * Deliberately not an effect on the filter. Applying one is a single act, so the caller changing
   * the filter and this dropping the anchor land in the same render -- where an effect would fetch
   * once against the anchor it is about to clear, and again once it had.
   */
  function handleFilterApplied() {
    if (at) {
      return;
    }
    abandonCurrentWindow();
  }

  /** Leaves history behind entirely: the live end is elsewhere, so it is fetched afresh. */
  async function jumpToLivestream() {
    if (anchor) {
      /**
       * Dropping the anchor re-runs the load effect, which fetches the live end and opens at the
       * bottom of it. Nothing is scrolled *here*, and `hasNewer` is put down before anything else:
       * the window still on screen belongs to history, and pushing it to its own bottom used to set
       * it walking forwards a page per request -- with the pin-to-bottom effect, freed by the very
       * anchor being cleared, re-triggering the scroll each time its own output landed. Four days
       * back meant hundreds of round trips to travel a distance one request already covered.
       */
      setParameters(Internal.withoutPin, { replace: true });
      abandonCurrentWindow();
      return;
    }
    await catchupWithLatestEvents();
    scrollToBottom();
  }

  /**
   * Jumping is a URL change plus an anchor move; the load effect does the rest.
   *
   * Except when the anchor would not actually move -- pressing Jump on the instant already loaded,
   * or re-pinning one that was dismissed. There is nothing to fetch in either case, so the marker is
   * simply put back and scrolled to, on the frame after it exists.
   */
  function jumpTo(instant: Temporal.Instant) {
    const jumped = instant.toString();
    setParameters((previous) => Internal.withPin(previous, jumped));
    if (anchor?.kind !== "timestamp" || LogAnchor.value(anchor) !== jumped) {
      setAnchor({ kind: "timestamp", value: instant });
      return;
    }
    requestAnimationFrame(() => LogRow.landed(scrollWindowRef.current)?.scrollIntoView({ block: "center" }));
  }

  async function openJumpDialog() {
    // the dialog opens on the moment already marked, if the mark is a moment at all
    const chosen = await dialogClient.jumpTo(at?.kind === "timestamp" ? at.value : undefined);
    if (chosen !== "cancel") {
      jumpTo(chosen);
    }
  }

  /**
   * Pins one message, by the reader clicking its timestamp.
   *
   * The window does not move: they are already looking at the line, so this only writes the marker.
   * Pressing it again takes the pin off, which makes the timestamp a toggle rather than a one-way
   * door -- the little `x` is the other way out, and reaching for the line itself is the obvious
   * one. The anchor moves with it so a reload opens here rather than at the live feed.
   */
  function togglePinnedLine(lineId: string) {
    if (at?.kind === "id" && at.value === lineId) {
      setParameters(Internal.withoutPin, { replace: true });
      setAnchor(undefined);
      return;
    }
    setParameters((previous) => Internal.withPin(previous, lineId), { replace: true });
    setAnchor({ kind: "id", value: lineId });
  }

  /**
   * Moves the window onto a line found outside it -- and the jump marker, which described the window
   * being left behind, goes with it rather than being redrawn somewhere it never pointed at.
   */
  function anchorToLine(lineId: string) {
    setParameters(Internal.withoutPin, { replace: true });
    setAnchor({ kind: "id", value: lineId });
  }

  /**
   * Only the marker goes. The anchor deliberately stays put, so the window the reader is in survives
   * -- see where it is declared.
   */
  function dismissPin() {
    setParameters(Internal.withoutPin, { replace: true });
  }

  /**
   * Paging forward is driven from here rather than from the pin-to-bottom effect on purpose:
   * appending leaves the reader at the bottom, so an effect would fire again on its own output and
   * race to the live feed without them scrolling once.
   */
  function handleScroll() {
    // measured by this very scroll, where the `atBottom` state is still the answer from before it
    const nowAtBottom = onScroll();
    const element = scrollWindowRef.current;
    if (!element) {
      return;
    }
    if (element.scrollTop === 0) {
      void loadOlder();
      return;
    }
    if (hasNewer && nowAtBottom) {
      void loadNewer();
    }
  }

  return {
    scrollWindowRef,
    events,
    lines,
    loading,
    anchor,
    isFollowingStream,
    handleScroll,
    jumpToLive: jumpToLivestream,
    openJumpDialog,
    dismissPin,
    togglePinnedLine,
    anchorToLine,
    handleFilterApplied,
  };
}

namespace Internal {
  /**
   * The marker written into a url that holds more than the marker, and taken back out of one.
   *
   * Only {@link useContainerLogs.AT_PARAM} is touched; the filter beside it is left exactly as
   * it was found. Restating the whole query string instead is what used to make dismissing the
   * marker quietly drop the reader's filter and re-fetch the log unfiltered -- a wholesale write
   * deletes by omission, and this hook has no business deleting a parameter it does not own.
   */
  export function withPin(previous: URLSearchParams, at: string): URLSearchParams {
    const next = new URLSearchParams(previous);
    next.set(useContainerLogs.AT_PARAM, at);
    return next;
  }

  export function withoutPin(previous: URLSearchParams): URLSearchParams {
    const next = new URLSearchParams(previous);
    next.delete(useContainerLogs.AT_PARAM);
    return next;
  }
}

export namespace useContainerLogs {
  export const AT_PARAM = "at";

  export type Options = {
    containerId: string;
    activeFilter: useLogFilter.Filter;
    parameters: URLSearchParams;
    setParameters: SetURLSearchParams;
  };

  export type Result = {
    scrollWindowRef: RefObject<HTMLDivElement | null>;
    events: ContainerEvent[];
    lines: Line[];
    loading: boolean;
    anchor?: LogAnchor;
    isFollowingStream: boolean;
    handleScroll: () => void;
    jumpToLive: () => Promise<void>;
    openJumpDialog: () => Promise<void>;
    dismissPin: () => void;
    /** Pins one message, or unpins it if it is the one already pinned. */
    togglePinnedLine: (lineId: string) => void;
    /** Moves the window onto a line outside it, which is how a search result is arrived at. */
    anchorToLine: (lineId: string) => void;
    /** Told that a filter has been applied, so the window can decide where that leaves the reader. */
    handleFilterApplied: () => void;
  };
}
