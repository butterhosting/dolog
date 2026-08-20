import { Anchor } from "@/models/Anchor";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ServerMessage } from "@/models/socket/ServerMessage";
import { useEffect, useMemo, useRef } from "react";
import { SocketClient } from "../clients/SocketClient";
import { Line } from "../rendering/Line";
import { Renderer } from "../rendering/Renderer";
import { useContainerLoading } from "./useContainerLoading";
import { useLogFilter } from "./useLogFilter";
import { useRegistry } from "./useRegistry";
import { useScrollManager } from "./useScrollManager";

const LINES_PER_PAGE = 300;

export function useContainerLogs({ containerId, filter, anchor, scrollManager }: useContainerLogs.Options): useContainerLogs.Result {
  const socketClient = useRegistry(SocketClient);
  const renderer = useRegistry(Renderer);

  const { events, setEvents, loadingRef, isLoading, hasNewer, hasOlder, landedAt, requestLogs } = useContainerLoading({
    containerId,
    filter,
  });

  const isFollowingStream = scrollManager.currentWindowPosition.atTheBottom && !hasNewer;
  const isFollowingStreamRef = useRef(isFollowingStream);
  useEffect(() => void (isFollowingStreamRef.current = isFollowingStream), [isFollowingStream]);

  const lines = useMemo(
    () => renderer.render({ anchor, events, hasOlder, hasNewer, landedAt }),
    [anchor, events, hasOlder, hasNewer, landedAt],
  );

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
  // Connect to the stream
  //
  function followStream() {
    requestLogs("latest", {
      postDOM: scrollManager.move.toTheBottom,
    });
  }

  //
  // Initial loading
  //
  useEffect(() => {
    if (anchor) {
      requestLogs("around", anchor.value, {
        postDOM: scrollManager.move.toAnchor,
      });
    } else {
      requestLogs("latest");
    }
  }, []);

  //
  // Loading older events (backwards in time)
  //
  useEffect(() => {
    if (scrollManager.currentWindowPosition.atTheTop) {
      const oldest = events.at(0);
      if (!hasOlder || !oldest) {
        return;
      }
      requestLogs("backwards", oldest.id, {
        // restore the current scroll position, because we're prepending new lines
        postDOM: scrollManager.currentWindowPosition.createRestoreFn(),
      });
    }
  }, [scrollManager.currentWindowPosition.atTheTop]);

  //
  // Loading newer events (forwards in time)
  //
  useEffect(() => {
    if (scrollManager.currentWindowPosition.atTheBottom) {
      const newest = events.at(-1);
      if (!hasNewer || !newest) {
        return;
      }
      requestLogs("forwards", newest.id);
    }
  }, [scrollManager.currentWindowPosition.atTheBottom]);

  //
  // Effect to keep ourselves stuck to the bottom (when following the stream)
  //
  useEffect(() => {
    if (loadingRef.current === "backwards") {
      return; // don't stick to the bottom, if we're in the middle of paging upwards
    }
    if (isFollowingStream) {
      scrollManager.move.toTheBottom();
    }
  }, [events, isFollowingStream]);

  return {
    lines,
    events,
    isLoading,
    isFollowingStream,
    followStream,
  };
}

export namespace useContainerLogs {
  export type Options = {
    containerId: string;
    filter: useLogFilter.ClientFilter;
    anchor?: Anchor;
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
