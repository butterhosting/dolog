import { Uuid } from "@/helpers/Uuid";
import { ContainerEvent } from "@/models/ContainerEvent";
import { LogAnchor } from "@/models/LogAnchor";
import { ServerMessage } from "@/models/socket/ServerMessage";
import { Temporal } from "@js-temporal/polyfill";
import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router";
import { DialogClient } from "../clients/DialogClient";
import { LogClient } from "../clients/LogClient";
import { SocketClient } from "../clients/SocketClient";
import { LogRow } from "../comps/logviewer/LogRow";
import { LogRows } from "../models/LogRows";
import { useLogFilter } from "./useLogFilter";
import { useRegistry } from "./useRegistry";
import { useStickyScroll } from "./useStickyScroll";

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

  const at = parameters.get(useContainerLogs.AT_PARAM);

  const [events, setEvents] = useState<ContainerEvent[]>([]);
  const [anchor, setAnchor] = useState<LogAnchor | null>(() => LogAnchor.parse(at));

  const [loading, setLoading] = useState(true);
  const loadingOlder = useRef(false);
  const loadingNewer = useRef(false);

  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [reachesLiveFeed, setReachesLiveFeed] = useState(false);

  const [landedAt, setLandedAt] = useState<string | null>(null);

  const { ref, stuck, atBottom, onScroll, scrollToBottom } = useStickyScroll<HTMLDivElement>(events, !anchor);
  const isFollowingStream = useRef(true);
  const hasMissedDataWhilePaused = useRef(false);

  const marker = useMemo(() => LogAnchor.parse(at), [at]);

  /**
   * The lines plus their markers. Recomputed only when the list actually changes, since it walks
   * every rendered event and the live feed re-renders this component every second.
   */
  const { rows, landedAtEnd } = useMemo(
    () => LogRows.build({ events, hasOlder, marker, landedOn: landedAt }),
    [events, hasOlder, marker, landedAt],
  );

  /**
   * Puts the reader on what they navigated to, once it has actually been drawn.
   *
   * This waits for a render rather than living in the load itself, because the load only *asks* for
   * the rows -- React draws them when it draws them, and for a few hundred of them that is not the
   * next frame. Scrolling from inside the fetch aimed at a row that did not exist yet, found
   * nothing, and left the window sitting at the top of the page above the one that was asked for.
   *
   * `scrolledTo` is what keeps it to once per anchor: `rows` changes with every arriving line, and
   * without it the view would be dragged back to the marker for as long as the marker existed.
   */
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!anchor || loading || rows.length === 0 || scrolledTo.current === LogAnchor.format(anchor)) {
      return;
    }
    const element = ref.current;
    /**
     * A line anchor is aimed at the line itself; a moment anchor at whatever marker was drawn for
     * it, which is not always on the first row -- asking for a time past the end of the log puts it
     * below the last one.
     */
    const target = anchor.kind === "id" ? LogRow.element(element, anchor.value) : LogRow.landed(element);
    if (!target) {
      // nothing was drawn for it: what they were shown instead is the end of history
      if (element) {
        element.scrollTop = element.scrollHeight;
        scrolledTo.current = LogAnchor.format(anchor);
      }
      return;
    }
    scrolledTo.current = LogAnchor.format(anchor);
    // put what they asked for in the middle of the view rather than at an edge
    target.scrollIntoView({ block: "center" });
  }, [anchor, loading, rows, ref]);

  /** What is on screen, for callbacks that would otherwise be rebuilt on every arriving line. */
  const rendered = useRef<ContainerEvent[]>([]);
  useEffect(() => {
    rendered.current = events;
  }, [events]);

  /**
   * Interest is declared *before* the history is fetched, and whatever arrives meanwhile is held
   * back until it lands.
   *
   * Fetching first would lose a second of output: retention writes in batches, so the database
   * trails the live stream, and lines written in that window are in neither the page we asked for
   * nor the feed we had not yet subscribed to.
   */
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
        /**
         * Live lines are not appended while the reader has scrolled away: that would grow the list
         * from below at the same time paging grows it from above, and the cap would then eat the
         * very history being read. They are not lost either -- the server still has them, and
         * returning to the bottom fetches whatever was missed.
         *
         * `following` also stays false while the window sits back in history, where appending would
         * be worse than untidy: a line from today would print directly beneath one from March, as
         * though it came next.
         */
        if (isFollowingStream.current) {
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

    void (async () => {
      /**
       * `at` is the marker exactly as the url holds it -- a pinned line or a moment, whichever it
       * is. Telling the two apart is the server's business now, and so is opening the window
       * *around* it: the page above used to be a second request stitched on here.
       */
      const page = await logClient.list(containerId, {
        limit: LINES_PER_PAGE,
        at: anchor ? LogAnchor.format(anchor) : undefined,
        ...useLogFilter.serialize(activeFilter),
      });
      if (cancelled) {
        return;
      }
      /**
       * Landing in history means lines from the live end do not belong here, so they are dropped
       * rather than merged. Arriving at the live end is the opposite: the tail of the page and the
       * head of the buffer overlap, and whatever the page missed is appended.
       */
      const shown = new Set(page.data.map((event) => event.id));
      const missed = anchor ? [] : arrivedDuringFetch.filter((event) => !shown.has(event.id));
      const window = [...page.data, ...missed];
      setEvents(anchor ? window : window.slice(-LINES_PER_PAGE));
      setLandedAt(page.landedAt ?? null);
      setHasOlder(page.hasOlder);
      setHasNewer(page.hasNewer);
      setReachesLiveFeed(page.reachesLiveFeed);
      setLoading(false);
      historyLoaded = true;
      if (!anchor) {
        /**
         * A window with no anchor *is* the live end, so it opens at the bottom -- said outright
         * rather than left to whether the reader happened to be stuck to the bottom of whatever
         * window came before this one.
         */
        requestAnimationFrame(() => scrollToBottom());
      }
    })();

    return () => {
      cancelled = true;
      socketClient.declareStreamInterest(null);
      socketClient.unsubscribe(subscription);
    };
    // re-runs on a jump, which is exactly right: a new position means a new window and a fresh fetch.
    // `activeFilter` is depended on by identity, which `useLogFilter` holds steady for as long as the
    // filter is unchanged -- a re-fetch clears the list and takes the reader's place in it with it,
    // so it must happen when the filter changes and on no other occasion.
  }, [containerId, anchor, activeFilter, logClient, socketClient, ref, scrollToBottom]);

  /**
   * Scrolling to the very top pulls in the page above. The scroll position is restored afterwards by
   * measuring how much taller the content became, otherwise prepending would jump the reader.
   */
  const loadOlder = useCallback(async () => {
    const element = ref.current;
    const oldest = events.at(0);
    if (!element || !hasOlder || !oldest || loadingOlder.current) {
      return;
    }
    loadingOlder.current = true;
    const before = element.scrollHeight;
    /**
     * The cursor is the topmost line on screen, not something held aside from an earlier fetch.
     * A stored one used to drift: trimming the list while tailing moved the top of the screen
     * forward while the cursor stayed put, and resuming from it skipped everything in between.
     */
    const page = await logClient.list(containerId, {
      limit: LINES_PER_PAGE,
      beforeExclusive: oldest.id,
      ...useLogFilter.serialize(activeFilter),
    });
    setHasOlder(page.hasOlder);

    /**
     * Nothing is dropped from the bottom here. Trimming there is what used to break the way back:
     * the newest lines were discarded, so scrolling down ran out of content and the reader could
     * only escape with the button. Keeping them means the list still ends at the live feed, so
     * coming back down needs no request at all and rejoins it seamlessly.
     *
     * The height change therefore sits entirely above the viewport, which is what makes this one
     * correction sufficient.
     */
    setEvents((current) => [...page.data, ...current]);
    requestAnimationFrame(() => {
      element.scrollTop += element.scrollHeight - before;
      loadingOlder.current = false;
    });
  }, [activeFilter, logClient, events, containerId, hasOlder, ref]);

  /**
   * The downward twin of {@link loadOlder}, and a simpler one: content appended below the viewport
   * moves nothing above it, so there is no scroll position to put back.
   *
   * Only reachable once the window has been moved off the live feed, since that is the only time
   * there is anything ahead of it to fetch.
   */
  const loadNewer = useCallback(async () => {
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
  }, [activeFilter, logClient, events, hasNewer, containerId]);

  /**
   * Catches up on whatever arrived while the reader was away. Reaching the bottom by scrolling and
   * reaching it by pressing the button are the same act, so both end here -- otherwise "at the
   * bottom" would mean *showing everything* one way and merely *appending from now on* the other,
   * and the difference is a silent hole in the log.
   *
   * Nothing arrived, nothing to do: a short glance upwards costs no request and causes no flicker.
   */
  const rejoinLive = useCallback(async () => {
    if (!hasMissedDataWhilePaused.current) {
      return;
    }
    hasMissedDataWhilePaused.current = false;
    const page = await logClient.list(containerId, { limit: LINES_PER_PAGE, ...useLogFilter.serialize(activeFilter) });
    const known = new Set(rendered.current.map((event) => event.id));

    /**
     * Sharing a line with what is already on screen means the two meet, so they are merged and the
     * history read so far survives. Sharing none means more than a page went by while the reader was
     * away, and the gap cannot be bridged from one request -- then the page is all we honestly have.
     */
    if (!page.data.some((event) => known.has(event.id))) {
      setEvents(page.data);
      setHasOlder(page.hasOlder);
      return;
    }
    setEvents(Internal.mergeById(rendered.current, page.data));
  }, [activeFilter, logClient, containerId]);

  /**
   * Following means sitting at the bottom *of the live feed*. Being at the bottom of a window parked
   * in history is not the same thing, and must not start appending live lines to it.
   *
   * An anchor rules it out on its own, whatever the window happens to contain. Asking for a time
   * with nothing after it leaves `hasNewer` false -- true, but not because we are at the live end --
   * and following on that alone quietly turned a history view back into a live one.
   */
  const atLiveEnd = stuck && reachesLiveFeed && !anchor;
  useEffect(() => {
    isFollowingStream.current = atLiveEnd;
    if (atLiveEnd) {
      void rejoinLive();
    }
  }, [atLiveEnd, rejoinLive]);

  /**
   * Puts the window back at the live end without moving the view: the anchor goes, and with it every
   * claim the old window made about where it sat. Shared with applying a filter, which lands in the
   * same place for the same reason.
   */
  const returnToLiveFeed = useCallback(() => {
    setHasNewer(false);
    // the new window has not answered yet, so nothing may be appended to the old one meanwhile
    setReachesLiveFeed(false);
    setAnchor(null);
  }, []);

  /** Leaves history behind entirely: the live end is elsewhere, so it is fetched afresh. */
  const jumpToLive = useCallback(async () => {
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
      returnToLiveFeed();
      return;
    }
    await rejoinLive();
    scrollToBottom();
  }, [anchor, rejoinLive, returnToLiveFeed, scrollToBottom, setParameters]);

  /**
   * Jumping is a URL change plus an anchor move; the load effect does the rest.
   *
   * Except when the anchor would not actually move -- pressing Jump on the instant already loaded,
   * or re-pinning one that was dismissed. There is nothing to fetch in either case, so the marker is
   * simply put back and scrolled to, on the frame after it exists.
   */
  const jumpTo = useCallback(
    (instant: Temporal.Instant) => {
      const at = instant.toString();
      setParameters((previous) => Internal.withPin(previous, at));
      if (anchor?.kind !== "timestamp" || LogAnchor.format(anchor) !== at) {
        setAnchor({ kind: "timestamp", value: instant });
        return;
      }
      requestAnimationFrame(() => LogRow.landed(ref.current)?.scrollIntoView({ block: "center" }));
    },
    [anchor, ref, setParameters],
  );

  const openJumpDialog = useCallback(async () => {
    const chosen = await dialogClient.jumpTo(LogRows.parseInstant(at) ?? undefined);
    if (chosen !== "cancel") {
      jumpTo(chosen);
    }
  }, [dialogClient, jumpTo, at]);

  /**
   * Pins one message, by the reader clicking its timestamp.
   *
   * The window does not move: they are already looking at the line, so this only writes the marker.
   * Pressing it again takes the pin off, which makes the timestamp a toggle rather than a one-way
   * door -- the little `x` is the other way out, and reaching for the line itself is the obvious
   * one. The anchor moves with it so a reload opens here rather than at the live feed.
   */
  const togglePinnedLine = useCallback(
    (lineId: string) => {
      if (at === lineId) {
        setParameters(Internal.withoutPin, { replace: true });
        setAnchor(null);
        return;
      }
      setParameters((previous) => Internal.withPin(previous, lineId), { replace: true });
      setAnchor({ kind: "id", value: lineId });
    },
    [at, setParameters],
  );

  /**
   * Moves the window onto a line found outside it -- and the jump marker, which described the window
   * being left behind, goes with it rather than being redrawn somewhere it never pointed at.
   */
  const anchorToLine = useCallback(
    (lineId: string) => {
      setParameters(Internal.withoutPin, { replace: true });
      setAnchor({ kind: "id", value: lineId });
    },
    [setParameters],
  );

  /**
   * Only the marker goes. The anchor deliberately stays put, so the window the reader is in survives
   * -- see where it is declared.
   */
  const dismissPin = useCallback(() => {
    setParameters(Internal.withoutPin, { replace: true });
  }, [setParameters]);

  /**
   * Paging forward is driven from here rather than from the `stuck` effect on purpose: appending
   * leaves the reader at the bottom, so an effect would fire again on its own output and race to
   * the live feed without them scrolling once.
   */
  const handleScroll = useCallback(() => {
    onScroll();
    const element = ref.current;
    if (!element) {
      return;
    }
    if (element.scrollTop === 0) {
      void loadOlder();
      return;
    }
    if (hasNewer && atBottom()) {
      void loadNewer();
    }
  }, [hasNewer, loadNewer, loadOlder, onScroll, ref, atBottom]);

  return {
    ref,
    events,
    rendered,
    rows,
    landedAtEnd,
    loading,
    hasOlder,
    hasNewer,
    anchor,
    at,
    atLiveEnd,
    handleScroll,
    jumpToLive,
    openJumpDialog,
    dismissPin,
    togglePinnedLine,
    anchorToLine,
    returnToLiveFeed,
  };
}

namespace Internal {
  /**
   * Two overlapping stretches of one log, as one. Keyed by id so a line held twice is held once,
   * and sorted by it because a uuidv7 sorts the way the log reads.
   */
  export function mergeById(held: ContainerEvent[], arriving: ContainerEvent[]): ContainerEvent[] {
    const merged = new Map(held.map((event) => [event.id, event]));
    arriving.forEach((event) => merged.set(event.id, event));
    return [...merged.values()].sort((one, other) => one.id.localeCompare(other.id));
  }

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
    ref: RefObject<HTMLDivElement | null>;
    events: ContainerEvent[];
    /** What is on screen, for callers that must not be rebuilt on every arriving line. */
    rendered: RefObject<ContainerEvent[]>;
    rows: LogRows.Row[];
    landedAtEnd: boolean;
    loading: boolean;
    hasOlder: boolean;
    hasNewer: boolean;
    anchor: LogAnchor | null;
    /**
     * The marker as it stands, for the few decisions outside this hook that turn on whether the
     * reader deliberately marked a spot -- applying a filter being the one that does.
     */
    at: string | null;
    /** Sitting at the bottom *of the live feed*, which is not the same as the bottom of the window. */
    atLiveEnd: boolean;
    handleScroll: () => void;
    jumpToLive: () => Promise<void>;
    openJumpDialog: () => Promise<void>;
    dismissPin: () => void;
    /** Pins one message, or unpins it if it is the one already pinned. */
    togglePinnedLine: (lineId: string) => void;
    /** Moves the window onto a line outside it, which is how a search result is arrived at. */
    anchorToLine: (lineId: string) => void;
    returnToLiveFeed: () => void;
  };
}
