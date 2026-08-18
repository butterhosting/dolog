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

const LINES_PER_PAGE = 300;

export function useContainerLogs({ containerId, filter, anchor, scrollToBottom }: useContainerLogs.Options): useContainerLogs.Result {
  const logClient = useRegistry(LogClient);
  const socketClient = useRegistry(SocketClient);
  const renderer = useRegistry(Renderer);

  const [events, setEvents] = useState<ContainerEvent[]>([]);

  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [landedAt, setLandedAt] = useState<string>();

  const [isFollowingStream, setFollowingStream] = useState(Internal.isInitiallyFollowingStream({ anchor }));
  const isFollowingStreamRef = useRef(isFollowingStream);

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
    const { data, hasNewer, hasOlder, landedAt } = await logClient.list(containerId, {
      ...Internal.requestOptions(variant, cursorOrTimestamp),
      ...useLogFilter.serialize(filter),
    });

    switch (variant) {
      case "latest":
      case "around":
      case "around_timestamp": {
        setEvents(data);
        setHasNewer(hasNewer);
        setHasOlder(hasOlder);
        if (variant === "latest") {
          setFollowingStream(true);
        }
        break;
      }
      case "previous": {
        setEvents((existingEvents) => [...data, ...existingEvents]);
        setHasOlder(hasOlder);
        break;
      }
      case "next": {
        setEvents((existingEvents) => [...data, ...existingEvents]);
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
  // Initial load
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
  // Keep the visible window pinned to the bottom at all times
  //
  useEffect(() => {
    if (isFollowingStream) {
      scrollToBottom();
    }
  }, [isFollowingStream, events]);

  return {
    lines,
    events,
    isLoading: true,
    isFollowingLivestream: true,
  };
}

namespace Internal {
  export function isInitiallyFollowingStream(data: { anchor?: LogAnchor }): boolean {
    return !Boolean(data.anchor);
  }

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
    scrollToBottom: () => unknown;
  };
  export type Result = {
    lines: Line[];
    events: ContainerEvent[];
    isLoading: boolean;
    isFollowingLivestream: boolean;
  };
}
