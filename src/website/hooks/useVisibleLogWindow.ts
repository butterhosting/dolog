import { ContainerEvent } from "@/models/ContainerEvent";
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

/**
 * How many lines a request asks for, and how many the live feed keeps -- following holds one page.
 *
 * Deliberately not a cap on what is rendered: paging back adds a page at a time and discards
 * nothing, so the list grows for as long as the reader keeps climbing and only returns to one page
 * once they rejoin the live feed. Bounding that too would mean being able to fetch *forward* when
 * they scroll down again, which needs an `after` cursor the API does not have.
 */
const LINES_PER_PAGE = 300;

/**
 * The window over a container's log: which lines are held, where in history it sits, and every way
 * of moving it. The live feed, paging in both directions, and the marker all belong here because
 * they are the same question asked from different ends -- what is on screen, and does the feed
 * still own the bottom of it.
 */
export function useVisibleLogWindow({
  id,
  applied,
  filterKey,
  pinnedAt,
  setParameters,
}: useVisibleLogWindow.Options): useVisibleLogWindow.Result {
  const logClient = useRegistry(LogClient);
  const socketClient = useRegistry(SocketClient);
  const dialogClient = useRegistry(DialogClient);

  /**
   * Where the window was fetched around, which is a different question from where the marker is.
   *
   * They begin life together and part company when the marker is dismissed: taking it away is a
   * change of mind about an annotation, not about where the reader is standing. Fetching off the
   * marker would mean the little `x` silently re-ran the load and threw them back to the live feed,
   * losing the history they had paged in -- so the anchor is moved by jumping, and by nothing else.
   *
   * It names a moment or a line, because those are the two ways of arriving somewhere: a jump knows
   * a time, a search knows an id. A found line cannot be described by its timestamp -- several lines
   * share a millisecond -- so the distinction has to survive as far as the request.
   */
  const [anchor, setAnchor] = useState<useVisibleLogWindow.Anchor | null>(pinnedAt ? { kind: "instant", value: pinnedAt } : null);

  const [events, setEvents] = useState<ContainerEvent[]>([]);
  /**
   * The line the server settled on for the current anchor, straight from its answer rather than
   * re-derived here. Its boundary is a millisecond and an instant can sit inside one, so a scan for
   * the first timestamp at or after the instant could pick a different line than the one the window
   * was actually fetched around.
   */
  const [landedOn, setLandedOn] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  /** True once the window sits somewhere in history rather than at the live feed. */
  const [hasNewer, setHasNewer] = useState(false);
  const [reachesLiveFeed, setReachesLiveFeed] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadingOlder = useRef(false);
  const loadingNewer = useRef(false);

  const { ref, stuck, atBottom, onScroll, scrollToBottom } = useStickyScroll<HTMLDivElement>(events, !anchor);
  /**
   * Read by the socket callback, which closes over its first render and would otherwise never see
   * the reader scroll away.
   */
  const following = useRef(true);
  /** Whether anything arrived while paused, and so whether returning to the bottom has to catch up. */
  const missedWhilePaused = useRef(false);

  /**
   * The lines plus their markers. Recomputed only when the list actually changes, since it walks
   * every rendered event and the live feed re-renders this component every second.
   */
  const { rows, landedAtEnd } = useMemo(
    () =>
      LogRows.build({
        events,
        reachedBeginning: !hasOlder,
        landedAt: LogRows.parseInstant(pinnedAt),
        landedOn,
      }),
    [events, hasOlder, pinnedAt, landedOn],
  );

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
        if (data.container.id !== id) {
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
        if (following.current) {
          setEvents((current) => [...current, data].slice(-LINES_PER_PAGE));
        } else {
          missedWhilePaused.current = true;
        }
      },
    });
    socketClient.declareStreamInterest(id, applied.pattern ? { pattern: applied.pattern, patternVariant: applied.variant } : null);

    void (async () => {
      const page = await logClient.list(id, {
        limit: LINES_PER_PAGE,
        at: anchor?.kind === "instant" ? (LogRows.parseInstant(anchor.value) ?? undefined) : undefined,
        afterInclusive: anchor?.kind === "line" ? anchor.value : undefined,
        ...useLogFilter.toRequest(applied),
      });
      if (cancelled) {
        return;
      }
      /**
       * Arriving at a timestamp reads forwards from it, so the window would begin exactly there --
       * with the reader pinned against its top edge, seeing nothing of what led up to the moment
       * they asked about. A page of context is fetched above it so they arrive in the middle of
       * events rather than at their leading edge.
       */
      const landing = anchor ? page.data.at(0) : undefined;
      const above = landing
        ? await logClient.list(id, { limit: LINES_PER_PAGE, beforeExclusive: landing.id, ...useLogFilter.toRequest(applied) })
        : undefined;
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
      const window = [...(above?.data ?? []), ...page.data, ...missed];
      setEvents(anchor ? window : window.slice(-LINES_PER_PAGE));
      setLandedOn(page.landedOn ?? null);
      setHasOlder(above ? above.hasOlder : page.hasOlder);
      setHasNewer(page.hasNewer);
      setReachesLiveFeed(page.reachesLiveFeed);
      setLoading(false);
      historyLoaded = true;
      if (landing) {
        requestAnimationFrame(() => {
          const element = ref.current;
          /**
           * A line anchor is aimed at the line itself; a moment anchor at whatever marker was drawn
           * for it, which is not always on the first row -- asking for a time past the end of the
           * log puts it below the last one.
           */
          const target = anchor?.kind === "line" ? LogRow.element(element, anchor.value) : LogRow.landed(element);
          if (target) {
            // put what they asked for in the middle of the view rather than at an edge
            target.scrollIntoView({ block: "center" });
          } else if (element) {
            // nothing was logged at or after it, so what they were shown instead is the end of history
            element.scrollTop = element.scrollHeight;
          }
        });
      } else {
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
    // Watched through `filterKey` rather than `applied` itself: a re-fetch clears the list and shows
    // a spinner, so it must happen when the filter changes and on no other occasion -- and `useMemo`
    // promises a cache, not an identity. The effect still reads `applied`, which is the one matching
    // whichever key it re-ran on.
  }, [id, anchor, filterKey, logClient, socketClient, ref, scrollToBottom]);

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
    const page = await logClient.list(id, { limit: LINES_PER_PAGE, beforeExclusive: oldest.id, ...useLogFilter.toRequest(applied) });
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
  }, [applied, logClient, events, id, hasOlder, ref]);

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
    const page = await logClient.list(id, { limit: LINES_PER_PAGE, afterExclusive: newest.id, ...useLogFilter.toRequest(applied) });
    setHasNewer(page.hasNewer);
    setReachesLiveFeed(page.reachesLiveFeed);
    setEvents((current) => [...current, ...page.data]);
    loadingNewer.current = false;
  }, [applied, logClient, events, hasNewer, id]);

  /**
   * Catches up on whatever arrived while the reader was away. Reaching the bottom by scrolling and
   * reaching it by pressing the button are the same act, so both end here -- otherwise "at the
   * bottom" would mean *showing everything* one way and merely *appending from now on* the other,
   * and the difference is a silent hole in the log.
   *
   * Nothing arrived, nothing to do: a short glance upwards costs no request and causes no flicker.
   */
  const rejoinLive = useCallback(async () => {
    if (!missedWhilePaused.current) {
      return;
    }
    missedWhilePaused.current = false;
    const page = await logClient.list(id, { limit: LINES_PER_PAGE, ...useLogFilter.toRequest(applied) });
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
    const merged = new Map(rendered.current.map((event) => [event.id, event]));
    page.data.forEach((event) => merged.set(event.id, event));
    setEvents([...merged.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }, [applied, logClient, id]);

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
    following.current = atLiveEnd;
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
      setParameters({}, { replace: true });
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
      setParameters({ at });
      if (anchor?.kind !== "instant" || anchor.value !== at) {
        setAnchor({ kind: "instant", value: at });
        return;
      }
      requestAnimationFrame(() => LogRow.landed(ref.current)?.scrollIntoView({ block: "center" }));
    },
    [anchor, ref, setParameters],
  );

  const openJumpDialog = useCallback(async () => {
    const chosen = await dialogClient.jumpTo(LogRows.parseInstant(pinnedAt) ?? undefined);
    if (chosen !== "cancel") {
      jumpTo(chosen);
    }
  }, [dialogClient, jumpTo, pinnedAt]);

  /**
   * Moves the window onto a line found outside it -- and the jump marker, which described the window
   * being left behind, goes with it rather than being redrawn somewhere it never pointed at.
   */
  const anchorToLine = useCallback(
    (lineId: string) => {
      setParameters({}, { replace: true });
      setAnchor({ kind: "line", value: lineId });
    },
    [setParameters],
  );

  /**
   * Only the marker goes. The anchor deliberately stays put, so the window the reader is in survives
   * -- see where it is declared.
   */
  const dismissPin = useCallback(() => {
    setParameters({}, { replace: true });
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
    atLiveEnd,
    handleScroll,
    jumpToLive,
    openJumpDialog,
    dismissPin,
    anchorToLine,
    returnToLiveFeed,
  };
}

export namespace useVisibleLogWindow {
  /** Where the window was fetched around: a moment that was asked for, or a line that was found. */
  export type Anchor = { kind: "instant"; value: string } | { kind: "line"; value: string };

  export type Options = {
    id: string;
    /** The filter in force, as every request applies it. */
    applied: useLogFilter.Filter;
    /** The same filter reduced to a comparable string, which is what a re-fetch is decided on. */
    filterKey: string;
    /** The marker in the url, which is where the window first opens. */
    pinnedAt: string | null;
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
    anchor: Anchor | null;
    /** Sitting at the bottom *of the live feed*, which is not the same as the bottom of the window. */
    atLiveEnd: boolean;
    handleScroll: () => void;
    jumpToLive: () => Promise<void>;
    openJumpDialog: () => Promise<void>;
    dismissPin: () => void;
    /** Moves the window onto a line outside it, which is how a search result is arrived at. */
    anchorToLine: (lineId: string) => void;
    returnToLiveFeed: () => void;
  };
}
