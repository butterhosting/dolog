import { Anchor } from "@/models/Anchor";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ServerMessage } from "@/models/socket/ServerMessage";
import { useEffect, useMemo, useRef } from "react";
import { SocketClient } from "../clients/SocketClient";
import { Line } from "../rendering/Line";
import { LineRenderer } from "../rendering/Renderer";
import { useRegistry } from "./basics/useRegistry";
import { ClientFilter } from "./objects/ClientFilter";
import { ParentNode } from "./objects/ParentNode";
import { useLoading } from "./useLoading";

export function useLogs({ containerId, parentNode, filter, anchor }: useLogs.Options): useLogs.Result {
  const socketClient = useRegistry(SocketClient);
  const renderer = useRegistry(LineRenderer);

  const { events, appendEvent, loadingRef, isLoading, hasNewer, hasOlder, requestLogs } = useLoading({
    containerId,
    filter,
  });

  const isFollowingStream = parentNode.currentScrollWindowPosition.atTheBottom && !hasNewer;
  const isFollowingStreamRef = useRef(isFollowingStream);
  useEffect(() => void (isFollowingStreamRef.current = isFollowingStream), [isFollowingStream]);

  //
  // Stream functionality
  //
  const hasMissedDataWhilePaused = useRef(false);
  useEffect(() => {
    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.event,
      callback: ({ data: event }) => {
        if (event.type === ContainerEvent.Type.stop) {
          console.log(`Browser STOP; ${event.id}; ${JSON.stringify(event.container, null, 2)}`);
        }
        if (event.container.id !== containerId) {
          return;
        }
        // Live lines are _only_ appended while the reader is tailing the end of the logs ...
        // ... otherwise they're noted as missed, and caught up on when they return. The window can
        // turn one down as well, mid-load, which counts as missed for the same reason
        if (!isFollowingStreamRef.current || !appendEvent(event)) {
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
  // Navigate to the end of stream
  //
  function followStream() {
    requestLogs("latest", {
      postDOM: parentNode.move.toTheBottom,
    });
  }

  //
  // Navigate to a specific event by ID (possible unloaded atm)
  //
  function navigateTo(eventId: string) {
    requestLogs("around", eventId, {
      postDOM: () => parentNode.move.toEvent(eventId),
    });
  }

  //
  // Initial loading
  //
  useEffect(() => {
    if (anchor) {
      requestLogs("around", anchor.value, {
        postDOM: parentNode.move.toAnchor,
      });
    } else {
      requestLogs("latest");
    }
  }, [filter]); // ⚠️ treat each filter change as an initial load

  //
  // Loading older events (backwards in time)
  //
  useEffect(() => {
    if (parentNode.currentScrollWindowPosition.atTheTop) {
      const oldest = events.at(0);
      if (!hasOlder || !oldest) {
        return;
      }
      requestLogs("backwards", oldest.id, {
        // restore the current scroll position, because we're prepending new lines
        postDOM: parentNode.currentScrollWindowPosition.createRestoreFn(),
      });
    }
  }, [parentNode.currentScrollWindowPosition.atTheTop]);

  //
  // Loading newer events (forwards in time)
  //
  useEffect(() => {
    if (parentNode.currentScrollWindowPosition.atTheBottom) {
      const newest = events.at(-1);
      if (!hasNewer || !newest) {
        return;
      }
      requestLogs("forwards", newest.id);
    }
  }, [parentNode.currentScrollWindowPosition.atTheBottom]);

  //
  // Effect to keep ourselves stuck to the bottom (when following the stream)
  //
  useEffect(() => {
    if (loadingRef.current === "backwards") {
      return; // don't stick to the bottom, if we're in the middle of paging upwards
    }
    if (isFollowingStream) {
      parentNode.move.toTheBottom();
    }
  }, [events, isFollowingStream]);

  //
  // Effect for dealing with an Anchor change
  //
  const honouredAnchor = useRef(anchor);
  useEffect(() => {
    if (anchor === honouredAnchor.current) {
      return;
    }
    honouredAnchor.current = anchor;
    if (anchor) {
      if (anchor.type === "id") {
        return; // anchors of type "id" are obtained by clicking on a line ... no navigation needed
      }
      requestLogs("around", anchor.value, {
        postDOM: parentNode.move.toAnchor,
      });
    }
  }, [anchor]);

  //
  // Actually render the events
  //
  const lines = useMemo(() => renderer.render({ anchor, events, hasOlder, hasNewer }), [anchor, events, hasOlder, hasNewer]);

  return {
    lines,
    events,
    isLoading,
    isFollowingStream,
    followStream,
    navigateTo,
  };
}

export namespace useLogs {
  export type Options = {
    containerId: string;
    parentNode: ParentNode;
    filter: ClientFilter;
    anchor?: Anchor;
  };
  export type Result = {
    lines: Line[];
    events: ContainerEvent[];
    isLoading: boolean;
    isFollowingStream: boolean;
    followStream(): void;
    navigateTo(eventId: string): void;
  };
}
