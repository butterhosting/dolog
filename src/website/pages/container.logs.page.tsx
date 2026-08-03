import { ContainerEvent } from "@/models/ContainerEvent";
import { StreamVariant } from "@/models/StreamVariant";
import { ServerMessage } from "@/socket/ServerMessage";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ContainerClient } from "../clients/ContainerClient";
import { SocketClient } from "../clients/SocketClient";
import { Spinner } from "../comps/Spinner";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useRegistry } from "../hooks/useRegistry";
import { useStickyScroll } from "../hooks/useStickyScroll";
import { Route } from "../Route";

/**
 * How many lines are kept while following the live feed, and how many are fetched per page on the
 * way back. Purely a performance knob: paging back grows the list beyond this and nothing is
 * discarded until the reader returns to the bottom, so it never limits how far back they can go.
 */
const MAX_LINES_RENDERED = 300;

export function containerLogsPage() {
  const { id = "" } = useParams();
  const containerClient = useRegistry(ContainerClient);
  const socketClient = useRegistry(SocketClient);

  const [events, setEvents] = useState<ContainerEvent[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadingOlder = useRef(false);

  const name = events.at(-1)?.container.name ?? events.at(0)?.container.name ?? id.slice(0, 12);
  useDocumentTitle(`${name} | Dolog`);

  const { ref, stuck, onScroll, scrollToBottom } = useStickyScroll<HTMLDivElement>(events);
  /**
   * Read by the socket callback, which closes over its first render and would otherwise never see
   * the reader scroll away.
   */
  const following = useRef(true);
  useEffect(() => {
    following.current = stuck;
  }, [stuck]);

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
         * Live lines are dropped while the reader has scrolled away, rather than appended. Keeping
         * them would grow the list from below at the same time paging grows it from above, and the
         * cap would then eat the very history being read. Jumping back re-fetches instead.
         */
        if (following.current) {
          setEvents((current) => [...current, event].slice(-MAX_LINES_RENDERED));
        }
      },
    });
    socketClient.declareContainerInterest(id);

    containerClient.logs(id, { limit: MAX_LINES_RENDERED }).then((page) => {
      if (cancelled) {
        return;
      }
      // the tail of the page and the head of the buffer overlap, so anything already shown is dropped
      const shown = new Set(page.events.map((event) => event.id));
      const missed = arrivedDuringFetch.filter((event) => !shown.has(event.id));
      setEvents([...page.events, ...missed].slice(-MAX_LINES_RENDERED));
      setHasOlder(page.hasOlder);
      setLoading(false);
      historyLoaded = true;
    });

    return () => {
      cancelled = true;
      socketClient.declareContainerInterest(null);
      socketClient.unsubscribe(subscription);
    };
  }, [id, containerClient, socketClient]);

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
    const page = await containerClient.logs(id, { limit: MAX_LINES_RENDERED, before: oldest.id });
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
   * Re-fetches rather than merely scrolling, because whatever arrived while the reader was paused was
   * never added, and the newest lines may have been trimmed away as they paged upwards.
   */
  const jumpToLive = useCallback(async () => {
    const page = await containerClient.logs(id, { limit: MAX_LINES_RENDERED });
    setEvents(page.events);
    setHasOlder(page.hasOlder);
    scrollToBottom();
  }, [containerClient, id, scrollToBottom]);

  const handleScroll = useCallback(() => {
    onScroll();
    if ((ref.current?.scrollTop ?? 1) === 0) {
      void loadOlder();
    }
  }, [loadOlder, onScroll, ref]);

  return (
    <div className="flex flex-col h-screen py-6 gap-4">
      <div className="flex items-baseline gap-4">
        <Link to={Route.containers()} className="text-c-accent hover:underline">
          ← containers
        </Link>
        <span className="font-bold">{name}</span>
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
          className="h-full overflow-y-auto [overflow-anchor:none] rounded-2xl bg-c-dark-full text-gray-200 font-mono text-xs p-4 leading-relaxed"
        >
          {loading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {!loading && events.length === 0 && <div className="text-c-dark-half py-8 text-center">No logs recorded yet</div>}
          {!loading && hasOlder && <div className="text-c-dark-half text-center pb-2">scroll up for more</div>}
          {!loading && !hasOlder && events.length > 0 && (
            <div className="text-c-dark-half text-center pb-2">that is the beginning</div>
          )}
          {events.map((event) => (
            <Internal.Line key={event.id} event={event} />
          ))}
        </div>

        {!stuck && (
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
  export function Line({ event }: { event: ContainerEvent }) {
    const time = event.timestamp.toString({ smallestUnit: "second" }).replace("T", " ").replace("Z", "");
    return (
      /*
       * Deliberately not `content-visibility: auto`. It does make a long list cheaper, but a skipped
       * line contributes an estimated height, so scrolling to the bottom stops short of it and the
       * live feed reads as paused when it is not. Plain rows keep the geometry exact.
       */
      <div className="flex gap-3 whitespace-pre-wrap break-all">
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
