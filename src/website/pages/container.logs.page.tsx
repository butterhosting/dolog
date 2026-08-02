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

const MAX_LINES_RENDERED = 50;

export function containerLogsPage() {
  const { id = "" } = useParams();
  const containerClient = useRegistry(ContainerClient);
  const socketClient = useRegistry(SocketClient);

  const [events, setEvents] = useState<ContainerEvent[]>([]);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingOlder = useRef(false);

  const name = events.at(-1)?.container.name ?? events.at(0)?.container.name ?? id.slice(0, 12);
  useDocumentTitle(`${name} | Dolog`);

  const { ref, stuck, onScroll, scrollToBottom } = useStickyScroll<HTMLDivElement>(events);

  /**
   * History first, then the live feed. Told the server what we want *after* the fetch, so anything
   * arriving in between lands after the page we already have rather than being lost above it.
   */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEvents([]);
    containerClient.logs(id).then((page) => {
      if (cancelled) {
        return;
      }
      setEvents(page.events);
      setOlderCursor(page.olderCursor);
      setLoading(false);
      socketClient.declareContainerInterest(id);
    });
    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.log,
      callback: ({ event }) => {
        if (event.container.id === id) {
          setEvents((current) => [...current, event].slice(-MAX_LINES_RENDERED));
        }
      },
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
    if (!element || olderCursor === null || loadingOlder.current) {
      return;
    }
    loadingOlder.current = true;
    const before = element.scrollHeight;
    const page = await containerClient.logs(id, olderCursor);
    setEvents((current) => [...page.events, ...current]);
    setOlderCursor(page.olderCursor);
    requestAnimationFrame(() => {
      element.scrollTop += element.scrollHeight - before;
      loadingOlder.current = false;
    });
  }, [containerClient, id, olderCursor, ref]);

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
        <div
          ref={ref}
          onScroll={handleScroll}
          className="h-full overflow-y-auto rounded-2xl bg-c-dark-full text-gray-200 font-mono text-xs p-4 leading-relaxed"
        >
          {loading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {!loading && events.length === 0 && <div className="text-c-dark-half py-8 text-center">No logs recorded yet</div>}
          {!loading && olderCursor !== null && <div className="text-c-dark-half text-center pb-2">scroll up for more</div>}
          {events.map((event, index) => (
            <Internal.Line key={index} event={event} />
          ))}
        </div>

        {!stuck && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 rounded-full bg-c-accent text-white text-xs px-4 py-2 shadow-lg cursor-pointer hover:opacity-90"
          >
            ↓ jump to live
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
