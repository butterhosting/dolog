import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { LogAnchor } from "@/models/LogAnchor";
import { ServerMessage } from "@/models/socket/ServerMessage";
import { Temporal } from "@js-temporal/polyfill";
import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import { DialogClient } from "../clients/DialogClient";
import { LogClient } from "../clients/LogClient";
import { SocketClient } from "../clients/SocketClient";
import { LogRow } from "../comps/logviewer/LogRow";
import { Line } from "../rendering/Line";
import { Renderer } from "../rendering/Renderer";
import { useLogAnchor } from "./useLogAnchor";
import { useLogFilter } from "./useLogFilter";
import { useRegistry } from "./useRegistry";
import { useScrollToAnchor } from "./useScrollToAnchor";
import { useStickyScrollWindow } from "./useStickyScrollWindow";

const LINES_PER_PAGE = 300;

export function useContainerLogs({ containerId, activeFilter, logAnchor }: useContainerLogs.Options): useContainerLogs.Result {
  const logClient = useRegistry(LogClient);
  const socketClient = useRegistry(SocketClient);
  const dialogClient = useRegistry(DialogClient);
  const renderer = useRegistry(Renderer);

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<ContainerEvent[]>([]);

  /**
   * Where the window *is* -- which is the only honest answer to that question, since it is set from
   * the response rather than from anyone's intention. `undefined` means the live end.
   *
   * Nothing else records a position. An anchor is a request to go somewhere and is finished the
   * moment it has been honoured; letting it go afterwards moves nothing, because nothing about the
   * window is remembered in it.
   */
  const [requestedAnchor, setRequestedAnchor] = useState<string | undefined>(logAnchor.anchor?.serialize());
  const [loadedFor, setLoadedFor] = useState<{ at?: string; filter: useLogFilter.Filter }>();
  const [pageHasOlder, setPageHasOlder] = useState(false);
  const [pageHasNewer, setPageHasNewer] = useState(false);
  const [pageLandedAt, setPageLandedAt] = useState<string>();
  const [pageReachesLiveFeed, setPageReachesLiveFeed] = useState(false);

  /**
   * Asking for a window and receiving it are two different moments, and in between the previous page
   * is still the one held -- so everything it claims is reported through this. Ask for somewhere
   * else and the claims stop counting in the same render, with nothing to remember to clear by hand.
   */
  const showsWhatWasAskedFor = loadedFor?.at === requestedAnchor && loadedFor?.filter === activeFilter;
  const hasOlder = showsWhatWasAskedFor && pageHasOlder;
  const hasNewer = showsWhatWasAskedFor && pageHasNewer;
  const reachesLiveFeed = showsWhatWasAskedFor && pageReachesLiveFeed;
  const landedAt = showsWhatWasAskedFor ? pageLandedAt : undefined;
  /** Read from where the window actually is, not from whether a marker happens to be set. */
  const showsLiveEnd = requestedAnchor === undefined;

  const { scrollWindowRef, atBottom, onScroll, scrollToBottom } = useStickyScrollWindow<HTMLDivElement>(events, showsLiveEnd);
  const isFollowingStreamRef = useRef(true);
  const hasMissedDataWhilePaused = useRef(false);

  const lines = useMemo(
    () => renderer.render({ events, hasOlder, hasNewer, anchor: logAnchor.anchor, landedAt }), //
    [events, hasOlder, hasNewer, logAnchor.anchor, landedAt],
  );

  //
  // Effect to receive the live stream. Deliberately independent of *where* the window sits: moving
  // it is not a reason to disturb a subscription, and this used to be torn down and re-declared on
  // every pin, jump and search result.
  //
  const isLoadingWindow = useRef(false);
  const arrivedWhileLoading = useRef<ContainerEvent[]>([]);
  useEffect(() => {
    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.log,
      callback: ({ data }) => {
        if (data.container.id !== containerId) {
          return;
        }
        /**
         * Held rather than dropped while a window is being fetched. Retention writes in batches, so
         * the database trails the live stream: a line written during the request is in neither the
         * page being fetched nor the list it is about to replace.
         */
        if (isLoadingWindow.current) {
          arrivedWhileLoading.current.push(data);
          return;
        }

        // Live lines are _only_ appended while the reader is tailing the end of the logs ...
        // ... otherwise they're noted as missed, and caught up on when they return
        if (isFollowingStreamRef.current) {
          setEvents((current) => [...current, data].slice(-LINES_PER_PAGE));
        } else {
          hasMissedDataWhilePaused.current = true;
        }
      },
    });
    socketClient.declareStreamInterest(
      containerId,
      activeFilter.pattern ? { pattern: activeFilter.pattern, patternVariant: activeFilter.variant } : null,
    );
    return () => {
      socketClient.declareStreamInterest(null);
      socketClient.unsubscribe(subscription);
    };
  }, [containerId, activeFilter, socketClient]);

  /**
   * Loads the stretch of log around `at`, or the live end when it is absent. The one way the window
   * ever moves -- an anchor, a search result and the live button all arrive here.
   *
   * `isLoadingWindow` goes up first and synchronously, which is what stops arriving lines being
   * appended to a window that is on its way out.
   */
  const loadGeneration = useRef(0);
  async function loadWindowAround(at?: string) {
    const generation = ++loadGeneration.current;
    isLoadingWindow.current = true;
    arrivedWhileLoading.current = [];
    setRequestedAnchor(at);
    setLoading(true);
    setEvents([]);

    const page = await logClient.list(containerId, {
      limit: LINES_PER_PAGE,
      at, // the latest logs when absent, otherwise the logs _around_ it
      ...useLogFilter.serialize(activeFilter),
    });
    if (generation !== loadGeneration.current) {
      return; // somewhere else was asked for while this was in flight
    }

    const combinedEvents = [...page.data];
    if (at === undefined) {
      const fetchedIds = new Set(page.data.map((event) => event.id));
      combinedEvents.push(...arrivedWhileLoading.current.filter((event) => !fetchedIds.has(event.id)));
    } else if (arrivedWhileLoading.current.length > 0) {
      // this window is history, so those lines do not belong in it -- but they are not lost
      hasMissedDataWhilePaused.current = true;
    }
    combinedEvents.splice(0, combinedEvents.length - LINES_PER_PAGE); // only keep the N latest events

    setEvents(combinedEvents);
    setLoadedFor({ at, filter: activeFilter });
    setPageLandedAt(page.landedAt);
    setPageHasOlder(page.hasOlder);
    setPageHasNewer(page.hasNewer);
    setPageReachesLiveFeed(page.reachesLiveFeed);
    setLoading(false);
    isLoadingWindow.current = false;

    if (at === undefined) {
      requestAnimationFrame(() => scrollToBottom());
    }
  }

  //
  // A new container, or a new filter, means the window has to be read again. Around the marker if
  // there is one -- whoever set it keeps their place -- and otherwise at the live end.
  //
  useEffect(() => {
    void loadWindowAround(logAnchor.anchor?.serialize());
    // `at` is read rather than depended on: a marker being dismissed is not a reason to re-fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, activeFilter]);

  //
  // An anchor is a request to go somewhere, and is spent once honoured. Letting one go afterwards
  // is not a request to go anywhere else, which is why only a set anchor is acted on here.
  //
  const honouredAnchor = useRef(logAnchor.anchor);
  useEffect(() => {
    if (!logAnchor.anchor || logAnchor.anchor === honouredAnchor.current) {
      return;
    }
    honouredAnchor.current = logAnchor.anchor;
    void loadWindowAround(logAnchor.anchor.serialize());
  }, [logAnchor.anchor]);

  useScrollToAnchor({
    scrollWindowRef,
    target: requestedAnchor,
    showsWhatWasAskedFor,
    loading,
    lines,
  });

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
    setPageHasOlder(page.hasOlder);
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
    setPageHasNewer(page.hasNewer);
    setPageReachesLiveFeed(page.reachesLiveFeed);
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
      setPageHasOlder(latestPage.hasOlder);
    }
  }

  //
  // Effect which checks if we should begin appending new logs as they come in (follow the stream)
  //
  const isFollowingStream = atBottom && reachesLiveFeed && showsLiveEnd;
  useEffect(() => {
    isFollowingStreamRef.current = isFollowingStream; // this will "follow the stream"
    if (isFollowingStream) {
      void catchupWithLatestEvents();
    }
  }, [isFollowingStream]);

  /** Leaves history behind entirely: the live end is elsewhere, so it is fetched afresh. */
  async function jumpToLivestream() {
    if (!showsLiveEnd) {
      /**
       * Reading the live end afresh, and opening at the bottom of it once it lands. Nothing is
       * scrolled *here*: the window still on screen belongs to history, and pushing it to its own
       * bottom used to set it walking forwards a page per request -- four days back meant hundreds
       * of round trips to travel a distance one request already covered.
       */
      logAnchor.clearAnchor();
      await loadWindowAround(undefined);
      return;
    }
    // already there, just behind
    await catchupWithLatestEvents();
    scrollToBottom();
  }

  /**
   * Moving the anchor is enough on its own: the load effect fetches, and the scroll effect lands on
   * it. The exception is a jump to where the window already is, which fetches nothing -- so there is
   * no new render to land on, and the view is put back on the marker by hand.
   */
  function jumpTo(instant: Temporal.Instant) {
    if (logAnchor.activateTimestampAnchor(instant) === "did_not_have_to_navigate") {
      return;
    }
    requestAnimationFrame(() => LogRow.landed(scrollWindowRef.current)?.scrollIntoView({ block: "center" }));
  }

  async function openJumpDialog() {
    // the dialog opens on the moment already marked, if the mark is a moment at all
    const chosen = await dialogClient.jumpTo(logAnchor.anchor?.type === "timestamp" ? logAnchor.anchor.value : undefined);
    if (chosen !== "cancel") {
      jumpTo(chosen);
    }
  }

  /**
   * Moves the window onto a line outside it, which is how a search result off the current page is
   * arrived at. Nothing is marked: a search moves the view, it does not plant a flag.
   */
  function moveWindowTo(eventId: string) {
    void loadWindowAround(eventId);
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
    isFollowingStream,
    handleScroll,
    jumpToLivestream,
    openJumpDialog,
    moveWindowTo,
  };
}

export namespace useContainerLogs {
  export type Options = {
    containerId: string;
    activeFilter: useLogFilter.Filter;
    logAnchor: useLogAnchor.Result;
  };

  export type Result = {
    scrollWindowRef: RefObject<HTMLDivElement | null>;
    events: ContainerEvent[];
    lines: Line[];
    loading: boolean;
    /** Whether the live end owns the bottom of the window, which is when to stop offering a way back. */
    isFollowingStream: boolean;
    handleScroll: () => void;
    jumpToLivestream: () => Promise<void>;
    openJumpDialog: () => Promise<void>;
    /** Moves the window onto a line outside it, leaving no marker. Used by search. */
    moveWindowTo: (eventId: string) => void;
  };
}
