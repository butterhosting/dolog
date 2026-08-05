import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import { StreamVariant } from "@/models/StreamVariant";
import { ServerMessage } from "@/models/socket/ServerMessage";
import clsx from "clsx";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ContainerClient } from "../clients/ContainerClient";
import { DialogClient } from "../clients/DialogClient";
import { SocketClient } from "../clients/SocketClient";
import { Button } from "../comps/Button";
import { Spinner } from "../comps/Spinner";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useRegistry } from "../hooks/useRegistry";
import { useStickyScroll } from "../hooks/useStickyScroll";
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
   */
  const [anchor, setAnchor] = useState(pinnedAt);

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

  const name = events.at(-1)?.container.name ?? events.at(0)?.container.name ?? id.slice(0, 12);
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
      callback: ({ event }) => {
        if (event.container.id !== id) {
          return;
        }
        if (!historyLoaded) {
          arrivedDuringFetch.push(event);
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
          setEvents((current) => [...current, event].slice(-LINES_PER_PAGE));
        } else {
          missedWhilePaused.current = true;
        }
      },
    });
    socketClient.declareContainerInterest(id);

    void (async () => {
      const page = await containerClient.logs(id, { limit: LINES_PER_PAGE, at: anchor ?? undefined });
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
      const above = landing ? await containerClient.logs(id, { limit: LINES_PER_PAGE, before: landing.id }) : undefined;
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
          const marker = element?.querySelector("[data-landed]");
          if (marker) {
            // put the moment they asked for in the middle of the view rather than at an edge
            marker.scrollIntoView({ block: "center" });
          } else if (element) {
            // nothing was logged at or after it, so what they were shown instead is the end of history
            element.scrollTop = element.scrollHeight;
          }
        });
      }
    })();

    return () => {
      cancelled = true;
      socketClient.declareContainerInterest(null);
      socketClient.unsubscribe(subscription);
    };
    // re-runs on a jump, which is exactly right: a new position means a new window and a fresh fetch
  }, [id, anchor, containerClient, socketClient, ref]);

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
    const page = await containerClient.logs(id, { limit: LINES_PER_PAGE, before: oldest.id });
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
  }, [containerClient, events, id, hasOlder, ref]);

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
    const page = await containerClient.logs(id, { limit: LINES_PER_PAGE, after: newest.id });
    setHasNewer(page.hasNewer);
    setEvents((current) => [...current, ...page.events]);
    loadingNewer.current = false;
  }, [containerClient, events, hasNewer, id]);

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
    const page = await containerClient.logs(id, { limit: LINES_PER_PAGE });
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
  }, [containerClient, id]);

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
      // dropping the anchor re-runs the load effect, which fetches the live end for us
      setParameters({}, { replace: true });
      setAnchor(null);
      scrollToBottom();
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
      if (at !== anchor) {
        setAnchor(at);
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
      {/*
       * The viewer owns the whole viewport, so the toolbar is the log surface's top edge rather than
       * a bar floating above it. The breadcrumb is the one thing left standing outside, which is why
       * the dark area is notched around it rather than starting at the corner.
       */}
      <div className="flex items-stretch">
        <div className="flex shrink-0 items-center gap-2 px-4 text-sm">
          <Link to={Route.containers()} className="text-c-accent hover:underline">
            Containers
          </Link>
          <span className="text-c-dark-half">/</span>
          <span className="font-bold">{name}</span>
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-tl-2xl bg-c-dark-full px-3 py-2">
          <Button onClick={() => void openJump()} theme="neutral" className="bg-white/10 hover:bg-white/20 py-1.5 text-xs">
            Jump
          </Button>
        </div>
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
              {anchor ? "Nothing was logged at or after that time" : "No logs recorded yet"}
            </div>
          )}
          {!loading && hasOlder && <div className="text-c-dark-half text-center pb-2">scroll up for more</div>}
          {!loading && !hasOlder && events.length > 0 && <div className="text-c-dark-half text-center pb-2">that is the beginning</div>}
          {rows.map(({ event, opensDay, landedOn }) => (
            <Fragment key={event.id}>
              {opensDay && <Internal.DayMarker date={opensDay} landedOn={landedOn === "day"} onDismiss={dismissPin} />}
              <Internal.Line event={event} landedOn={landedOn === "line"} onDismiss={dismissPin} />
            </Fragment>
          ))}
          {landedAtEnd && <Internal.TrailingMarker onDismiss={dismissPin} />}
          {!loading && hasNewer && <div className="text-c-dark-half text-center pt-2">scroll down for more</div>}
        </div>

        {/* offered whenever the feed is not being followed -- scrolled up, or parked in history */}
        {!atLiveEnd && (
          <button
            onClick={() => void jumpToLive()}
            title="new lines are not being added while you read back"
            className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-c-accent text-white text-xs pl-3 pr-4 py-2 shadow-lg cursor-pointer hover:opacity-90"
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
        <span aria-hidden className="pointer-events-none absolute -left-4 -right-4 -top-px h-px bg-green-400/70" />
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
      <div
        data-landed={landedOn ? "" : undefined}
        className="relative flex justify-center py-3 text-[11px] tracking-wide text-c-dark-half"
      >
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

  export function Line({ event, landedOn, onDismiss }: { event: ContainerEvent; landedOn: boolean; onDismiss: () => void }) {
    const time = event.timestamp.toString({ smallestUnit: "second" }).replace("T", " ").replace("Z", "");
    return (
      /*
       * Deliberately not `content-visibility: auto`. It does make a long list cheaper, but a skipped
       * line contributes an estimated height, so scrolling to the bottom stops short of it and the
       * live feed reads as paused when it is not. Plain rows keep the geometry exact.
       */
      <div data-landed={landedOn ? "" : undefined} className="relative flex gap-3 whitespace-pre-wrap break-all">
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
