import { ContainerEvent } from "@/models/ContainerEvent";
import { LogAnchor } from "@/models/LogAnchor";
import { ServerMessage } from "@/models/socket/ServerMessage";
import { LogService } from "@/services/LogService";
import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogClient } from "../clients/LogClient";
import { SocketClient } from "../clients/SocketClient";
import { Line } from "../rendering/Line";
import { Renderer } from "../rendering/Renderer";
import { useLogFilter } from "./useLogFilter";
import { useRegistry } from "./useRegistry";
import { useScrollManager } from "./useScrollManager";
import { Direction } from "@/models/Direction";

const LINES_PER_PAGE = 300;

export function useContainerLogs({ containerId, filter, anchor, scrollManager }: useContainerLogs.Options): useContainerLogs.Result {
  const logClient = useRegistry(LogClient);
  const socketClient = useRegistry(SocketClient);
  const renderer = useRegistry(Renderer);

  const [events, setEvents] = useState<ContainerEvent[]>([]);
  const [isLoading, setLoading] = useState(false);

  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [landedAt, setLandedAt] = useState<string>();

  const isFollowingStream = scrollManager.currentWindowPosition.atTheBottom && !hasNewer;
  const isFollowingStreamRef = useRef(isFollowingStream);
  useEffect(() => void (isFollowingStreamRef.current = isFollowingStream), [isFollowingStream]);

  const lines = useMemo(() => renderer.render({ events, hasOlder, hasNewer, landedAt }), [events, hasOlder, hasNewer, landedAt]);

  //
  // Stream functionality
  //
  const hasMissedDataWhilePaused = useRef(false);
  useEffect(() => {
    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.log,
      callback: ({ data }) => {
        if (data.container.id !== containerId) {
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
    socketClient.declareStreamInterest(containerId, filter);
    return () => {
      socketClient.undeclareStreamInterest();
      socketClient.unsubscribe(subscription);
    };
  }, [containerId, filter]);

  //
  // Load functionality
  //
  async function load(type: "latest"): Promise<void>;
  async function load(type: "previous" | "next" | "around", cursor: string): Promise<void>;
  async function load(type: "around_timestamp", timestamp: Temporal.Instant): Promise<void>;
  async function load(variant: Internal.LoadVariant, cursorOrTimestamp?: string | Temporal.Instant): Promise<void> {
    setLoading(true);
    const { data, hasNewer, hasOlder, landedAt } = await logClient
      .list(containerId, {
        ...Internal.requestOptions(variant, cursorOrTimestamp),
        ...useLogFilter.serialize(filter),
      })
      .finally(() => setLoading(false));

    switch (variant) {
      case "latest":
      case "around":
      case "around_timestamp": {
        setEvents(data);
        setHasNewer(hasNewer);
        setHasOlder(hasOlder);
        break;
      }
      case "previous": {
        setEvents((existingEvents) => [...data, ...existingEvents]);
        setHasOlder(hasOlder);
        break;
      }
      case "next": {
        setEvents((existingEvents) => [...existingEvents, ...data]);
        setHasNewer(hasNewer);
        break;
      }
      default: {
        variant satisfies never;
      }
    }
    setLandedAt(landedAt);
  }

  //
  // Initial loading
  //
  useEffect(() => {
    if (anchor?.type === "id") {
      load("around", anchor.value);
    } else if (anchor?.type === "timestamp") {
      load("around_timestamp", anchor.value);
    } else {
      load("latest");
    }
  }, []);

  //
  // Paging functionality: reaching either edge triggers a new load action
  // The presence or absence of the variable below indicates that a paging request is currently taking place
  //
  const pagingTransition = useRef<Internal.PagingTransition>(undefined);

  //
  // Loading older events (backwards in time)
  //
  useEffect(() => {
    if (scrollManager.currentWindowPosition.atTheTop) {
      const oldest = events.at(0);
      if (!hasOlder || !oldest || pagingTransition.current) {
        return;
      }
      pagingTransition.current = {
        direction: Direction.backwards_in_time,
        postLoadingHook: scrollManager.currentWindowPosition.createRestoreFn(), // restore the current scroll position, because we're prepending new lines
      };
      load("previous", oldest.id);
    }
  }, [scrollManager.currentWindowPosition.atTheTop]);

  //
  // Loading newer events (forwards in time)
  //
  useEffect(() => {
    if (scrollManager.currentWindowPosition.atTheBottom) {
      const newest = events.at(-1);
      if (!hasNewer || !newest || pagingTransition.current) {
        return;
      }
      pagingTransition.current = {
        direction: Direction.forwards_in_time,
      };
      load("next", newest.id);
    }
  }, [scrollManager.currentWindowPosition.atTheBottom]);

  //
  // Effect to keep ourselves stuck to the bottom (when following the stream)
  //
  useEffect(() => {
    if (pagingTransition.current?.direction === Direction.backwards_in_time) {
      return; // don't stick to the bottom, if we're in the middle of paging upwards
    }
    if (isFollowingStream) {
      scrollManager.move.toTheBottom();
    }
  }, [events, isFollowingStream]);

  //
  // Technical effect for any post-loading hooks (lifecycle management)
  //
  useEffect(() => {
    if (pagingTransition.current) {
      pagingTransition.current.postLoadingHook?.();
      pagingTransition.current = undefined;
    }
  }, [events]);

  return {
    lines,
    events,
    isLoading,
    isFollowingStream,
    followStream() {
      load("latest").then(() => scrollManager.move.toTheBottom());
    },
  };
}

namespace Internal {
  export type PagingTransition = {
    direction: Direction;
    postLoadingHook?: () => unknown;
  };

  export type LoadVariant = "latest" | "previous" | "next" | "around" | "around_timestamp";
  export function requestOptions(type: LoadVariant, cursorOrTimestamp?: string | Temporal.Instant): LogService.ListQuery {
    switch (type) {
      case "latest":
        return {};
      case "previous":
        return { beforeExclusive: cursorOrTimestamp as string };
      case "next":
        return { afterExclusive: cursorOrTimestamp as string };
      case "around":
        return { at: cursorOrTimestamp as string };
      case "around_timestamp":
        return { at: (cursorOrTimestamp as Temporal.Instant).toString() };
    }
  }
}

export namespace useContainerLogs {
  export type Options = {
    containerId: string;
    filter: useLogFilter.Filter;
    anchor?: LogAnchor;
    scrollManager: useScrollManager.Result;
  };
  export type Result = {
    lines: Line[];
    events: ContainerEvent[];
    isLoading: boolean;
    isFollowingStream: boolean;
    followStream(): void;
  };
}
