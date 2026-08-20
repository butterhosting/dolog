import { Anchor } from "@/models/Anchor";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ServerMessage } from "@/models/socket/ServerMessage";
import { useEffect, useMemo, useRef } from "react";
import { SocketClient } from "../clients/SocketClient";
import { Line } from "../rendering/Line";
import { LineRenderer } from "../rendering/Renderer";
import { useRegistry } from "./basics/useRegistry";
import { ClientFilter } from "./objects/ClientFilter";
import { PhysicalDOMContainer } from "./objects/PhysicalDOMContainer";
import { useLoading } from "./useLoading";

const LINES_PER_PAGE = 300;

export function useLogs({ containerId, physicalDOMContainer, filter, anchor }: useLogs.Options): useLogs.Result {
  const socketClient = useRegistry(SocketClient);
  const renderer = useRegistry(LineRenderer);

  const { events, setEvents, loadingRef, isLoading, hasNewer, hasOlder, landedAt, requestLogs } = useLoading({
    containerId,
    filter,
  });

  const isFollowingStream = physicalDOMContainer.currentScrollWindowPosition.atTheBottom && !hasNewer;
  const isFollowingStreamRef = useRef(isFollowingStream);
  useEffect(() => void (isFollowingStreamRef.current = isFollowingStream), [isFollowingStream]);

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
  // Navigate to the end of stream
  //
  function followStream() {
    requestLogs("latest", {
      postDOM: physicalDOMContainer.move.toTheBottom,
    });
  }

  //
  // Navigate to a specific event by ID (possible unloaded atm)
  //
  function navigateTo(eventId: string) {
    requestLogs("around", eventId, {
      postDOM: () => physicalDOMContainer.move.toEvent(eventId),
    });
  }

  //
  // Initial loading
  //
  useEffect(() => {
    if (anchor) {
      requestLogs("around", anchor.value, {
        postDOM: physicalDOMContainer.move.toAnchor,
      });
    } else {
      requestLogs("latest");
    }
  }, []);

  //
  // Loading older events (backwards in time)
  //
  useEffect(() => {
    if (physicalDOMContainer.currentScrollWindowPosition.atTheTop) {
      const oldest = events.at(0);
      if (!hasOlder || !oldest) {
        return;
      }
      requestLogs("backwards", oldest.id, {
        // restore the current scroll position, because we're prepending new lines
        postDOM: physicalDOMContainer.currentScrollWindowPosition.createRestoreFn(),
      });
    }
  }, [physicalDOMContainer.currentScrollWindowPosition.atTheTop]);

  //
  // Loading newer events (forwards in time)
  //
  useEffect(() => {
    if (physicalDOMContainer.currentScrollWindowPosition.atTheBottom) {
      const newest = events.at(-1);
      if (!hasNewer || !newest) {
        return;
      }
      requestLogs("forwards", newest.id);
    }
  }, [physicalDOMContainer.currentScrollWindowPosition.atTheBottom]);

  //
  // Effect to keep ourselves stuck to the bottom (when following the stream)
  //
  useEffect(() => {
    if (loadingRef.current === "backwards") {
      return; // don't stick to the bottom, if we're in the middle of paging upwards
    }
    if (isFollowingStream) {
      physicalDOMContainer.move.toTheBottom();
    }
  }, [events, isFollowingStream]);

  //
  // Effect to automatically navigate to a (timestamp) anchor after its declared
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
        postDOM: physicalDOMContainer.move.toAnchor,
      });
    }
  }, [anchor]);

  //
  // Actually render the events
  //
  const lines = useMemo(
    () => renderer.render({ anchor, events, hasOlder, hasNewer, landedAt }),
    [anchor, events, hasOlder, hasNewer, landedAt],
  );

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
    physicalDOMContainer: PhysicalDOMContainer;
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
