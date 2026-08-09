import { LogLinePattern } from "@/models/LogLinePattern";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import { StreamVariant } from "@/models/StreamVariant";
import { ServerMessage } from "@/models/socket/ServerMessage";
import clsx from "clsx";
import { Fragment, ReactNode, RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ContainerClient } from "../clients/ContainerClient";
import { DialogClient } from "../clients/DialogClient";
import { SocketClient } from "../clients/SocketClient";
import { Spinner } from "../comps/Spinner";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useRegistry } from "../hooks/useRegistry";
import { useStickyScroll } from "../hooks/useStickyScroll";
import { LogRange } from "../models/LogRange";
import { Route } from "../Route";

/**
 * How many lines a request asks for, and how many the live feed keeps -- following holds one page.
 *
 * Deliberately not a cap on what is rendered: paging back adds a page at a time and discards
 * nothing, so the list grows for as long as the reader keeps climbing and only returns to one page
 * once they rejoin the live feed. Bounding that too would mean being able to fetch *forward* when
 * they scroll down again, which needs an `after` cursor the API does not have.
 */
const LINES_PER_PAGE = 300;

/** How close to the bottom counts as being at it, since scroll positions are fractional. */
const BOTTOM_SLACK_PX = 24;

export function containerLogsPage() {
  const { id = "" } = useParams();
  const containerClient = useRegistry(ContainerClient);
  const socketClient = useRegistry(SocketClient);
  const dialogClient = useRegistry(DialogClient);

  /**
   * Where the marker is drawn, kept in the URL so the view can be linked and reloaded.
   */
  const [parameters, setParameters] = useSearchParams();
  const pinnedAt = parameters.get("at");
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
  const [anchor, setAnchor] = useState<Internal.Anchor | null>(pinnedAt ? { kind: "instant", value: pinnedAt } : null);

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
  const [loading, setLoading] = useState(true);
  const loadingOlder = useRef(false);
  const loadingNewer = useRef(false);

  const [needle, setNeedle] = useState("");
  const [variant, setVariant] = useState<LogLinePattern.Variant>(LogLinePattern.Variant.substr);
  /**
   * The match last stepped to. The only state search keeps, and it cannot go stale: every step
   * re-checks it against the viewport and drops it the moment it is not on screen, so it can never
   * pull the reader back to somewhere they have scrolled away from.
   */
  const [currentMatch, setCurrentMatch] = useState<string | null>(null);
  /** Which way, not merely whether -- so the chevron that was not pressed keeps still. */
  const [searching, setSearching] = useState<"up" | "down" | null>(null);
  /** So "there is nothing that way" can be said by the control that was asked. */
  const chevrons = { up: useRef<HTMLButtonElement>(null), down: useRef<HTMLButtonElement>(null) };
  const [finding, setFinding] = useState(false);
  const findField = useRef<HTMLInputElement>(null);

  /**
   * Closing takes the needle with it. The highlights are the search made visible, so leaving them
   * behind would mean a closed control still marking up the log -- with nothing on screen left to
   * explain why, or to clear them with.
   */
  const closeFind = useCallback(() => {
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
        findField.current?.select();
        findField.current?.focus();
      }
      if (event.key === "Escape") {
        closeFind();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeFind]);

  /**
   * The filter as it is being composed, kept apart from the filter in force. Unlike search, applying
   * one re-defines the window, so it waits for the button rather than following every keystroke.
   */
  const applied = useMemo(() => Internal.appliedFilter(parameters), [parameters]);
  const [filterDraft, setFilterDraft] = useState(applied.pattern);
  const [filterVariant, setFilterVariant] = useState<LogLinePattern.Variant>(applied.variant);
  const [rangeDraft, setRangeDraft] = useState<LogRange.Value>(applied.range);
  const filterDirty =
    filterDraft.trim() !== applied.pattern || filterVariant !== applied.variant || !LogRange.equals(rangeDraft, applied.range);
  /**
   * What the load effect watches. Not `parameters` itself: that also carries the marker, and a
   * dismissed marker must not re-fetch -- the very thing the anchor exists to prevent.
   */
  const filterKey = ["filter", "filterVariant", "range", "since", "until"].map((key) => parameters.get(key) ?? "").join(" ");
  /** Whether anything is being narrowed at all, which changes what an empty window means. */
  const filtering = applied.pattern !== "" || !LogRange.isAll(applied.range);

  const openRange = useCallback(async () => {
    const chosen = await dialogClient.pickRange(rangeDraft);
    if (chosen !== "cancel") {
      setRangeDraft(chosen);
    }
  }, [dialogClient, rangeDraft]);

  /**
   * A filter re-defines what the window *is*, but not where the reader is standing in it. A marker
   * is a place they chose deliberately, so changing what is shown keeps it and re-opens the window
   * around it; only jumping, or going live, moves it. With no marker there is nowhere to return to,
   * so the view starts again at the live end of the narrowed log.
   */
  const applyFilter = useCallback(() => {
    const pattern = filterDraft.trim();
    setParameters({
      ...(pinnedAt ? { at: pinnedAt } : {}),
      ...(pattern ? { filter: pattern, filterVariant } : {}),
      ...LogRange.toParams(rangeDraft),
    });
    if (!pinnedAt) {
      setAnchor(null);
      setHasNewer(false);
    }
  }, [filterDraft, filterVariant, pinnedAt, rangeDraft, setParameters]);

  /** Which of the loaded lines the needle lights up, and whether it is even a usable needle yet. */
  const { matched, broken } = useMemo(() => Internal.highlight(events, needle, variant), [events, needle, variant]);

  // a different needle makes the old match meaningless
  useEffect(() => {
    setCurrentMatch(null);
  }, [needle, variant]);

  /**
   * Taken from the overview rather than from the events, which carry it too -- but a filter matching
   * nothing leaves none to read it from, and the title would fall back to a chopped id for a
   * container that is perfectly well known.
   */
  const [name, setName] = useState(id.slice(0, 12));
  useEffect(() => {
    // asked for outright rather than waited for: the overview is only broadcast when it *changes*,
    // so a quiet container would never announce itself to a page that had just opened
    void containerClient.list().then((containers) => {
      const mine = containers.find((container) => container.id === id);
      if (mine) {
        setName(mine.name);
      }
    });
  }, [containerClient, id]);
  useEffect(() => {
    const found = events.at(-1)?.container.name ?? events.at(0)?.container.name;
    if (found) {
      setName(found);
    }
  }, [events]);
  useDocumentTitle(`${name} | Dolog`);

  const { ref, stuck, onScroll, scrollToBottom } = useStickyScroll<HTMLDivElement>(events, !anchor);
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
  const { rows, landedAtEnd } = useMemo(() => {
    const landedAt = Internal.parseInstant(pinnedAt);
    return Internal.rows(events, !hasOlder, landedAt, landedOn);
  }, [events, hasOlder, pinnedAt, landedOn]);

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
      const page = await containerClient.logs(id, {
        limit: LINES_PER_PAGE,
        at: anchor?.kind === "instant" ? anchor.value : undefined,
        afterInclusive: anchor?.kind === "line" ? anchor.value : undefined,
        filter: Internal.filterFor(applied),
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
      const landing = anchor ? page.events.at(0) : undefined;
      const above = landing
        ? await containerClient.logs(id, { limit: LINES_PER_PAGE, beforeExclusive: landing.id, filter: Internal.filterFor(applied) })
        : undefined;
      if (cancelled) {
        return;
      }
      /**
       * Landing in history means lines from the live end do not belong here, so they are dropped
       * rather than merged. Arriving at the live end is the opposite: the tail of the page and the
       * head of the buffer overlap, and whatever the page missed is appended.
       */
      const shown = new Set(page.events.map((event) => event.id));
      const missed = anchor ? [] : arrivedDuringFetch.filter((event) => !shown.has(event.id));
      const window = [...(above?.events ?? []), ...page.events, ...missed];
      setEvents(anchor ? window : window.slice(-LINES_PER_PAGE));
      setLandedOn(page.landedOn);
      setHasOlder(above ? above.hasOlder : page.hasOlder);
      setHasNewer(page.hasNewer);
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
          const target = anchor?.kind === "line" ? Internal.lineElement(element, anchor.value) : element?.querySelector("[data-landed]");
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
    // re-runs on a jump, which is exactly right: a new position means a new window and a fresh fetch
    // `filterKey` rather than `applied`, which is a fresh object on every render
  }, [id, anchor, filterKey, containerClient, socketClient, ref, scrollToBottom]);

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
    const page = await containerClient.logs(id, { limit: LINES_PER_PAGE, beforeExclusive: oldest.id, filter: Internal.filterFor(applied) });
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
    setEvents((current) => [...page.events, ...current]);
    requestAnimationFrame(() => {
      element.scrollTop += element.scrollHeight - before;
      loadingOlder.current = false;
    });
  }, [applied, containerClient, events, id, hasOlder, ref]);

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
    const page = await containerClient.logs(id, { limit: LINES_PER_PAGE, afterExclusive: newest.id, filter: Internal.filterFor(applied) });
    setHasNewer(page.hasNewer);
    setEvents((current) => [...current, ...page.events]);
    loadingNewer.current = false;
  }, [applied, containerClient, events, hasNewer, id]);

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
    const page = await containerClient.logs(id, { limit: LINES_PER_PAGE, filter: Internal.filterFor(applied) });
    const known = new Set(rendered.current.map((event) => event.id));

    /**
     * Sharing a line with what is already on screen means the two meet, so they are merged and the
     * history read so far survives. Sharing none means more than a page went by while the reader was
     * away, and the gap cannot be bridged from one request -- then the page is all we honestly have.
     */
    if (!page.events.some((event) => known.has(event.id))) {
      setEvents(page.events);
      setHasOlder(page.hasOlder);
      return;
    }
    const merged = new Map(rendered.current.map((event) => [event.id, event]));
    page.events.forEach((event) => merged.set(event.id, event));
    setEvents([...merged.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }, [applied, containerClient, id]);

  /**
   * Following means sitting at the bottom *of the live feed*. Being at the bottom of a window parked
   * in history is not the same thing, and must not start appending live lines to it.
   *
   * An anchor rules it out on its own, whatever the window happens to contain. Asking for a time
   * with nothing after it leaves `hasNewer` false -- true, but not because we are at the live end --
   * and following on that alone quietly turned a history view back into a live one.
   */
  const atLiveEnd = stuck && !hasNewer && !anchor;
  useEffect(() => {
    following.current = atLiveEnd;
    if (atLiveEnd) {
      void rejoinLive();
    }
  }, [atLiveEnd, rejoinLive]);

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
      setHasNewer(false);
      setParameters({}, { replace: true });
      setAnchor(null);
      return;
    }
    await rejoinLive();
    scrollToBottom();
  }, [anchor, rejoinLive, scrollToBottom, setParameters]);

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
      requestAnimationFrame(() => ref.current?.querySelector("[data-landed]")?.scrollIntoView({ block: "center" }));
    },
    [anchor, ref, setParameters],
  );

  const openJump = useCallback(async () => {
    const chosen = await dialogClient.jumpTo(Internal.parseInstant(pinnedAt) ?? undefined);
    if (chosen !== "cancel") {
      jumpTo(chosen);
    }
  }, [dialogClient, jumpTo, pinnedAt]);

  /**
   * Only the marker goes. The anchor deliberately stays put, so the window the reader is in survives
   * -- see where it is declared.
   */
  const dismissPin = useCallback(() => {
    setParameters({}, { replace: true });
  }, [setParameters]);

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
    async (direction: "up" | "down") => {
      const element = ref.current;
      const term = needle.trim();
      if (!element || !term || searching !== null) {
        return;
      }
      const onMatch = currentMatch !== null && Internal.onScreen(element, currentMatch);
      const edges = onMatch ? {} : Internal.visibleEdges(element);
      const from = onMatch ? currentMatch : direction === "up" ? edges.last : edges.first;

      setSearching(direction);
      try {
        const found = await containerClient.find(id, {
          pattern: term,
          patternVariant: variant,
          ...(onMatch ? { anchorExclusive: from } : { anchorInclusive: from }),
          direction,
          filter: Internal.filterFor(applied),
        });
        if (!found) {
          // deliberately no wrapping: in a log of unknown length, silently reappearing at the other
          // end reads as having lost your place rather than as having run out
          Internal.nudge(chevrons[direction].current);
          return;
        }
        setCurrentMatch(found);
        if (rendered.current.some((event) => event.id === found)) {
          /**
           * Only move the view for an answer the reader cannot already see. Recentring on a match
           * that was on screen the whole time shifts everything around it for no gain -- they were
           * reading that page, and the highlight moving is the whole of the news.
           */
          if (!Internal.onScreen(element, found)) {
            Internal.lineElement(element, found)?.scrollIntoView({ block: "center" });
          }
          return;
        }
        /**
         * The match is outside the window, so the window moves to it -- and the jump marker, which
         * described the window being left behind, goes with it rather than being redrawn somewhere
         * it never pointed at.
         */
        setParameters({}, { replace: true });
        setAnchor({ kind: "line", value: found });
      } finally {
        setSearching(null);
      }
    },
    [applied, containerClient, currentMatch, id, needle, ref, variant, searching, setParameters],
  );

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
    if (hasNewer && element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX) {
      void loadNewer();
    }
  }, [hasNewer, loadNewer, loadOlder, onScroll, ref]);

  return (
    <div className="full-bleed flex h-screen flex-col">
      <header className="relative flex items-center justify-center px-4 pb-3 pt-4">
        <Link to={Route.containers()} className="absolute left-4 text-sm text-c-accent hover:underline">
          ← Containers
        </Link>
        <span className="font-bold">{name}</span>
      </header>

      {/*
       * The controls sit a shade below the log surface rather than on it, so the two read as
       * separate planes -- one you act on, one you read.
       */}
      <div className="flex items-end gap-7 bg-c-dark-deep px-4 pb-3 pt-2">
        <Internal.Group label="Navigate">
          <Internal.Action onClick={() => void openJump()}>Jump</Internal.Action>
        </Internal.Group>

        <Internal.Group label="Filter">
          <Internal.Field>
            <Internal.RegexToggle
              on={filterVariant === "regex"}
              onClick={() =>
                setFilterVariant((c) => (c === LogLinePattern.Variant.regex ? LogLinePattern.Variant.substr : LogLinePattern.Variant.regex))
              }
            />
            <input
              value={filterDraft}
              onChange={(event) => setFilterDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && filterDirty && applyFilter()}
              placeholder="type to filter"
              className="w-72 bg-transparent font-mono text-xs text-c-dark-full outline-none placeholder:text-c-dark-half"
            />
          </Internal.Field>
          <Internal.Action onClick={applyFilter} disabled={!filterDirty}>
            Apply
          </Internal.Action>
        </Internal.Group>

        <div className="flex-1" />

        <Internal.Group label="Period">
          {/* the whole span is one control: it says what is covered, and opens the picker */}
          <Internal.Readout onClick={() => void openRange()} title="choose the time span this filter covers">
            {LogRange.label(rangeDraft)}
          </Internal.Readout>
        </Internal.Group>
      </div>

      <div className="relative flex-1 min-h-0">
        {/*
         * `overflow-anchor: none` because this list is edited at both ends and the browser's scroll
         * anchoring fights that. Trimming lines off the top made it rewind `scrollTop` to hold the
         * view still, which arrives as a scroll to somewhere far from the bottom -- and being at the
         * bottom is exactly how following is detected, so the feed latched to paused while lines
         * were still arriving. Both ends are compensated for deliberately here instead.
         */}
        <div
          ref={ref}
          onScroll={handleScroll}
          className="h-full overflow-y-auto [overflow-anchor:none] bg-c-dark-full text-gray-200 font-mono text-xs p-4 leading-relaxed"
        >
          {loading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {/* an empty window means something different once a time was asked for: logs may well exist, just not there */}
          {!loading && events.length === 0 && (
            <div className="text-c-dark-half py-8 text-center">
              {filtering
                ? "Nothing in this container matches the filter"
                : anchor?.kind === "instant"
                  ? "Nothing was logged at or after that time"
                  : "No logs recorded yet"}
            </div>
          )}
          {!loading && hasOlder && <div className="text-c-dark-half text-center pb-2">scroll up for more</div>}
          {!loading && !hasOlder && events.length > 0 && <div className="text-c-dark-half text-center pb-2">that is the beginning</div>}
          {rows.map(({ event, opensDay, landedOn }) => (
            <Fragment key={event.id}>
              {opensDay && <Internal.DayMarker date={opensDay} landedOn={landedOn === "day"} onDismiss={dismissPin} />}
              <Internal.Line
                event={event}
                landedOn={landedOn === "line"}
                onDismiss={dismissPin}
                matched={matched.has(event.id)}
                current={event.id === currentMatch}
              />
            </Fragment>
          ))}
          {landedAtEnd && <Internal.TrailingMarker onDismiss={dismissPin} />}
          {!loading && hasNewer && <div className="text-c-dark-half text-center pt-2">scroll down for more</div>}
        </div>

        {/*
         * Find rides over the log rather than sitting in the toolbar: it is a thing you reach for
         * mid-read and dismiss, not a setting the view is configured with. The filter is the
         * opposite, which is why only one of them is up there.
         */}
        {finding && (
          <div className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-xl bg-c-dark-deep p-2 shadow-2xl">
            <Internal.Field>
              <Internal.RegexToggle
                on={variant === "regex"}
                onClick={() =>
                  setVariant((c) => (c === LogLinePattern.Variant.regex ? LogLinePattern.Variant.substr : LogLinePattern.Variant.regex))
                }
              />
              <input
                ref={findField}
                autoFocus
                value={needle}
                onChange={(event) => setNeedle(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void step(event.shiftKey ? "up" : "down")}
                placeholder="type to search"
                className={clsx(
                  "w-56 bg-transparent font-mono text-xs outline-none placeholder:text-c-dark-half",
                  broken ? "text-c-error" : "text-c-dark-full",
                )}
              />
            </Internal.Field>
            {/* never disabled by a verdict: without all of history in hand, "no more" is only ever
                true of the search we last ran, not of the one about to be run */}
            <Internal.Step
              ref={chevrons.up}
              direction="up"
              onClick={() => void step("up")}
              disabled={!needle.trim()}
              busy={searching === "up"}
            />
            <Internal.Step
              ref={chevrons.down}
              direction="down"
              onClick={() => void step("down")}
              disabled={!needle.trim()}
              busy={searching === "down"}
            />
            <button onClick={closeFind} title="close (esc)" className="px-1.5 text-sm text-c-dark-half cursor-pointer hover:text-gray-200">
              ×
            </button>
          </div>
        )}

        {/* offered whenever the feed is not being followed -- scrolled up, or parked in history */}
        {!atLiveEnd && (
          <button
            onClick={() => void jumpToLive()}
            title="new lines are not being added while you read back"
            className={clsx(
              "absolute right-4 flex items-center gap-2 rounded-full bg-c-accent text-white text-xs pl-3 pr-4 py-2 shadow-lg cursor-pointer hover:opacity-90",
              // stacked above the find bar rather than under it, since both live in this corner
              finding ? "bottom-20" : "bottom-4",
            )}
          >
            <span className="rounded-full bg-yellow-400 text-c-dark-full font-bold px-2 py-0.5">paused</span>
            jump to live ↓
          </button>
        )}
      </div>
    </div>
  );
}

namespace Internal {
  /**
   * A line, plus whatever markers belong immediately above it. Markers live beside the log rather
   * than in it -- a synthetic full-width row would read as data, and would come along when copied.
   */
  type Row = {
    event: ContainerEvent;
    /** The date this line opens, when it differs from the line before it. */
    opensDay: string | null;
    /**
     * Which of this row's two seams a navigation timestamp fell on, if either -- above the day
     * marker, or between it and the line itself.
     */
    landedOn: "day" | "line" | null;
  };

  /** The rendered list, plus the one landing position that belongs to no row: past the last line. */
  type Rows = {
    rows: Row[];
    landedAtEnd: boolean;
  };

  /** Where the window was fetched around: a moment that was asked for, or a line that was found. */
  export type Anchor = { kind: "instant"; value: string } | { kind: "line"; value: string };

  /** The filter in force, which lives in the url rather than in state -- a view worth linking to. */
  export function appliedFilter(parameters: URLSearchParams) {
    const pattern = parameters.get("filter") ?? "";
    const variant = parameters.get("filterVariant") === "regex" ? LogLinePattern.Variant.regex : LogLinePattern.Variant.substr;
    return { pattern, variant, range: LogRange.fromParams(parameters) };
  }

  /**
   * The filter as the api takes it: absolute instants, resolved against the clock *now* rather than
   * when the filter was applied, so a relative span keeps meaning what it says.
   */
  export function filterFor(applied: ReturnType<typeof appliedFilter>): ContainerClient.Filter {
    const { since, until } = LogRange.window(applied.range, Temporal.Now.instant());
    return {
      pattern: applied.pattern || undefined,
      variant: applied.variant,
      since: since?.toString(),
      until: until?.toString(),
    };
  }

  export function lineElement(container: HTMLElement | null, eventId: string): HTMLElement | null {
    return container?.querySelector<HTMLElement>(`[data-event="${CSS.escape(eventId)}"]`) ?? null;
  }

  /**
   * Overlapping counts, so a line clipped by an edge is still "on screen" -- it is visible to the
   * reader, and the alternative is a chevron that skips whatever happens to straddle the boundary.
   */
  function overlaps(line: HTMLElement, container: HTMLElement): boolean {
    const bounds = container.getBoundingClientRect();
    const rect = line.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom;
  }

  export function onScreen(container: HTMLElement, eventId: string): boolean {
    const line = lineElement(container, eventId);
    return line !== null && overlaps(line, container);
  }

  /** The topmost and bottommost lines in view, which is what an unmatched search anchors on. */
  export function visibleEdges(container: HTMLElement): { first?: string; last?: string } {
    const shown = [...container.querySelectorAll<HTMLElement>("[data-event]")].filter((line) => overlaps(line, container));
    return { first: shown.at(0)?.dataset.event, last: shown.at(-1)?.dataset.event };
  }

  /**
   * Which loaded lines the needle lights up. Only ever a claim about what is in hand -- the count
   * beside the box says "on screen" for exactly that reason.
   */
  export function highlight(
    events: ContainerEvent[],
    needle: string,
    variant: LogLinePattern.Variant,
  ): { matched: Set<string>; broken: boolean } {
    const term = needle.trim();
    if (!term) {
      return { matched: new Set(), broken: false };
    }
    try {
      const matches = LogLinePattern.predicate({ pattern: term, patternVariant: variant });
      return {
        matched: new Set(events.filter((event) => event.type === ContainerEvent.Type.log && matches(event.line)).map((e) => e.id)),
        broken: false,
      };
    } catch {
      // half way through typing an expression, which is not yet an error worth shouting about
      return { matched: new Set(), broken: true };
    }
  }

  /**
   * One height, stated once, worn by every control in the bar. They were each sizing themselves from
   * their own padding, so a row of them came out ragged -- and stayed ragged whenever any one of them
   * gained a border or a slightly larger label.
   */
  const CONTROL = "h-9 rounded-lg inline-flex items-center";

  /** A labelled cluster of controls -- the three the toolbar is divided into. */
  export function Group({ label, children }: { label: string; children: ReactNode }) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-c-dark-half">{label}</span>
        <div className="flex items-center gap-1.5">{children}</div>
      </div>
    );
  }

  /** Reserved for controls that *do* something, which is what the colour is telling you. */
  export function Action({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className={clsx(
          CONTROL,
          "bg-c-action px-4 text-xs font-semibold text-c-dark-full cursor-pointer transition hover:brightness-110 disabled:opacity-25 disabled:cursor-default",
        )}
      >
        {children}
      </button>
    );
  }

  /** A white surface holding an input, and whatever sits beside it inside the same border. */
  export function Field({ children }: { children: ReactNode }) {
    return <span className={clsx(CONTROL, "gap-1.5 bg-white px-2")}>{children}</span>;
  }

  /** Reads like a field because it *says* something, but opens a picker rather than taking typing. */
  export function Readout({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
    return (
      <button onClick={onClick} title={title} className={clsx(CONTROL, "bg-white px-3 font-mono text-xs text-c-dark-full cursor-pointer")}>
        {children}
      </button>
    );
  }

  export function RegexToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
    return (
      <button
        onClick={onClick}
        title="read this as a regular expression"
        className={clsx(
          "rounded border px-1.5 py-0.5 font-mono text-[11px] cursor-pointer transition-colors",
          on
            ? "border-c-accent bg-c-accent text-white"
            : "border-c-dark-half/40 text-c-dark-half hover:border-c-dark-full hover:text-c-dark-full",
        )}
      >
        R
      </button>
    );
  }

  /**
   * A shake, driven from the element rather than from a class. A class would already be applied by
   * the time the second fruitless press arrived, and a css animation that is already running does
   * not restart -- so the reply to "still nothing?" would be silence.
   */
  export function nudge(element: HTMLElement | null): void {
    element?.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-2px)" }, { transform: "translateX(2px)" }, { transform: "translateX(0)" }],
      { duration: 75, iterations: 2, easing: "ease-in-out" },
    );
  }

  export function Step({
    ref,
    direction,
    onClick,
    disabled,
    busy,
  }: {
    ref: RefObject<HTMLButtonElement | null>;
    direction: "up" | "down";
    onClick: () => void;
    disabled: boolean;
    busy: boolean;
  }) {
    return (
      <button
        ref={ref}
        onClick={onClick}
        disabled={disabled}
        title={`${direction === "up" ? "previous" : "next"} match`}
        className={clsx(
          CONTROL,
          "w-9 justify-center bg-c-action text-c-dark-full cursor-pointer transition hover:brightness-110 disabled:opacity-25 disabled:cursor-default",
        )}
      >
        {busy ? (
          <span className="size-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <svg
            viewBox="0 0 10 6"
            className="w-2.5 fill-none stroke-current stroke-2"
            style={{ transform: direction === "up" ? "" : "rotate(180deg)" }}
          >
            <path d="M1 5 L5 1 L9 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    );
  }

  /** Dates as displayed: the same UTC the timestamps beside each line are printed in. */
  function day(event: ContainerEvent): string {
    return event.timestamp.toString().slice(0, 10);
  }

  /**
   * A day marker stands for the instant its day began, which is what lets a navigated timestamp be
   * placed against it rather than always beneath it.
   */
  function midnight(date: string): Temporal.Instant {
    return Temporal.Instant.from(`${date}T00:00:00Z`);
  }

  /** The URL is whatever was typed into it, so an unparseable one simply marks nothing. */
  export function parseInstant(value: string | null): Temporal.Instant | null {
    if (!value) {
      return null;
    }
    try {
      return Temporal.Instant.from(value);
    } catch {
      return null;
    }
  }

  export function rows(
    events: ContainerEvent[],
    reachedBeginning: boolean,
    landedAt: Temporal.Instant | null,
    landedOn: string | null,
  ): Rows {
    // `landedAt` says whether a marker is wanted at all; `landedOn` says where the server put it
    const landedIndex = !landedAt || !landedOn ? -1 : events.findIndex((event) => event.id === landedOn);
    /**
     * Asking for a moment later than anything logged. The server says so by landing on nothing, and
     * answers by reading *backwards*, so the reader is shown the end of history -- and the mark
     * belongs under the last line, because that is where the instant they asked for falls. Leaving
     * it off was the one case where jumping appeared to do nothing at all, which is easy to hit: a
     * picker offers today by default, and today is past the end of any container that has stopped.
     */
    const landedAtEnd = !!landedAt && landedOn === null && events.length > 0;
    const rows: Row[] = events.map((event, index) => {
      const previous = events[index - 1];
      /**
       * The topmost line gets a marker only once there is nothing above it. Otherwise the window
       * merely starts mid-day, and a marker there would claim a day began where it did not.
       */
      const opensDay = previous ? (day(previous) === day(event) ? null : day(event)) : reachedBeginning ? day(event) : null;
      return {
        event,
        opensDay,
        /**
         * One rule, applied to both seams: the mark sits above the first thing at or after the
         * instant asked for. A day marker counts as a thing, standing at midnight -- so landing
         * before the day began draws above it, and landing during the day draws below it, rather
         * than the mark always ending up beneath a date it precedes.
         */
        landedOn:
          index !== landedIndex
            ? null
            : opensDay && landedAt && Temporal.Instant.compare(landedAt, midnight(opensDay)) <= 0
              ? "day"
              : "line",
      };
    });
    return { rows, landedAtEnd };
  }

  /**
   * The seam a navigation landed on. Drawn across the boundary between two rows rather than inside
   * one, and absolutely so: it marks the seam without occupying it, adds no height, and never joins
   * a copied selection. The insets bleed it into the container's padding so it spans the full width.
   *
   * Its host is whichever row edge the instant fell on, so it needs a positioned parent either way.
   */
  function LandingRule({ onDismiss }: { onDismiss: () => void }) {
    return (
      <>
        <span aria-hidden className="pointer-events-none absolute -left-4 -right-4 -top-px h-px bg-c-action" />
        {/*
         * The one thing in the column that takes a click, so it is the one thing that keeps its
         * pointer events. Straddling the left edge puts it clear of the timestamps at any width.
         */}
        <button
          onClick={onDismiss}
          title="dismiss this marker"
          className="absolute -left-4 -top-2 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full bg-green-400 text-[10px] font-bold leading-none text-c-dark-full hover:bg-green-300"
        >
          ×
        </button>
      </>
    );
  }

  /**
   * Deliberately quiet: this only says which day the lines beneath it belong to, and a filled pill
   * gave that more weight than the log itself. Dimmed to the same register as the other notes around
   * the list, which also leaves the landing rule as the one coloured thing in the column.
   */
  export function DayMarker({ date, landedOn, onDismiss }: { date: string; landedOn: boolean; onDismiss: () => void }) {
    return (
      <div data-landed={landedOn ? "" : undefined} className="relative flex justify-center py-3 text-[11px] tracking-wide text-c-dark-half">
        {landedOn && <LandingRule onDismiss={onDismiss} />}
        {date}
      </div>
    );
  }

  /**
   * The marker when it sits past every line. Carries the height the rule cannot supply itself,
   * since it is drawn on this element's top edge and would otherwise hang off the end of the list.
   */
  export function TrailingMarker({ onDismiss }: { onDismiss: () => void }) {
    return (
      <div data-landed="" className="relative pt-3 text-[11px] text-c-dark-half">
        <LandingRule onDismiss={onDismiss} />
        <span className="block text-center">nothing was logged after this</span>
      </div>
    );
  }

  export function Line({
    event,
    landedOn,
    onDismiss,
    matched,
    current,
  }: {
    event: ContainerEvent;
    landedOn: boolean;
    onDismiss: () => void;
    matched: boolean;
    current: boolean;
  }) {
    const time = event.timestamp.toString({ smallestUnit: "second" }).replace("T", " ").replace("Z", "");
    return (
      /*
       * Deliberately not `content-visibility: auto`. It does make a long list cheaper, but a skipped
       * line contributes an estimated height, so scrolling to the bottom stops short of it and the
       * live feed reads as paused when it is not. Plain rows keep the geometry exact.
       */
      <div
        data-event={event.id}
        data-landed={landedOn ? "" : undefined}
        className={clsx(
          "relative flex gap-3 whitespace-pre-wrap break-all",
          // every match is lit, faintly; the one being stepped through is lit enough to find at a glance
          matched && "-mx-1 rounded-sm px-1",
          matched && !current && "bg-yellow-400/15",
          current && "bg-yellow-400/35 ring-1 ring-yellow-400/60",
        )}
      >
        {landedOn && <LandingRule onDismiss={onDismiss} />}
        <span className="text-gray-500 shrink-0">{time}</span>
        <span className={clsx("flex-1", colour(event))}>{describe(event)}</span>
      </div>
    );
  }

  function colour(event: ContainerEvent): string {
    switch (event.type) {
      case ContainerEvent.Type.start:
        return "text-green-400";
      case ContainerEvent.Type.stop:
        return "text-red-400";
      case ContainerEvent.Type.log_throttle:
        return "text-yellow-400";
      case ContainerEvent.Type.log:
        return event.streamVariant === StreamVariant.stderr ? "text-red-300" : "";
    }
  }

  function describe(event: ContainerEvent): string {
    switch (event.type) {
      case ContainerEvent.Type.start:
        return "▲ container started";
      case ContainerEvent.Type.stop:
        return "▼ container stopped";
      case ContainerEvent.Type.log_throttle:
        return `⚡ throttled; ${event.foldCount} messages dropped`;
      case ContainerEvent.Type.log:
        return event.line;
    }
  }
}
