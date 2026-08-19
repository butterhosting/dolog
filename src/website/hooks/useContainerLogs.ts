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
import { useElementManager } from "./useElementManager";
import { useLogFilter } from "./useLogFilter";
import { useRegistry } from "./useRegistry";
import { useScrollManager } from "./useScrollManager";

const LINES_PER_PAGE = 300;

export function useContainerLogs({ containerId, filter, anchor, scrollManager }: useContainerLogs.Options): useContainerLogs.Result {
  const logClient = useRegistry(LogClient);
  const socketClient = useRegistry(SocketClient);
  const renderer = useRegistry(Renderer);

  const [events, setEvents] = useState<ContainerEvent[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [loadingNonce, setLoadingNonce] = useState(0);

  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [landedAt, setLandedAt] = useState<string>();

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
  // The presence or absence of the variable below indicates that loading is currently taking place
  //
  const loadingTransition = useRef<Internal.LoadingTransition>(undefined);

  //
  // Load functionality
  //
  const loadingQueue = useRef(Promise.resolve());

  function loadLatest(options?: Internal.PostLoadingOptions) {
    return internalLoadQueue("latest", undefined, options);
  }
  function loadForwards(cursor: string, options?: Internal.PostLoadingOptions) {
    return internalLoadQueue("forwards", cursor, options);
  }
  function loadBackwards(cursor: string, options?: Internal.PostLoadingOptions) {
    return internalLoadQueue("backwards", cursor, options);
  }
  function loadAround(cursorOrTimestamp: string | Temporal.Instant, options?: Internal.PostLoadingOptions) {
    return internalLoadQueue("around", cursorOrTimestamp, options);
  }
  async function internalLoadQueue(
    variant: Internal.LoadingVariant,
    cursorOrTimestamp?: string | Temporal.Instant,
    options: Internal.PostLoadingOptions = {},
  ) {
    loadingQueue.current = loadingQueue.current.then(() => internalLoadDispatch(variant, cursorOrTimestamp, options));
    await loadingQueue.current;
  }
  async function internalLoadDispatch(
    variant: Internal.LoadingVariant,
    cursorOrTimestamp?: string | Temporal.Instant,
    options: Internal.PostLoadingOptions = {},
  ) {
    setLoading(true);
    const postLoadingId = Math.random();
    loadingTransition.current = {
      id: postLoadingId,
      variant,
      postLoadingHook: options?.postLoadingFn,
    };
    const { data, hasNewer, hasOlder, landedAt } = await logClient
      .list(containerId, {
        ...Internal.requestOptions(variant, cursorOrTimestamp),
        ...useLogFilter.serialize(filter),
      })
      .finally(() => setLoading(false));

    switch (variant) {
      case "latest":
      case "around": {
        setEvents(data);
        setHasNewer(hasNewer);
        setHasOlder(hasOlder);
        break;
      }
      case "backwards": {
        setEvents((existingEvents) => [...data, ...existingEvents]);
        setHasOlder(hasOlder);
        break;
      }
      case "forwards": {
        setEvents((existingEvents) => [...existingEvents, ...data]);
        setHasNewer(hasNewer);
        break;
      }
      default: {
        variant satisfies never;
      }
    }
    setLandedAt(landedAt);
    setLoadingNonce(postLoadingId);
  }

  //
  // Connect to the stream
  //
  function followStream() {
    loadLatest({
      postLoadingFn: scrollManager.move.toTheBottom,
    });
  }

  //
  // Initial loading
  //
  useEffect(() => {
    if (anchor) {
      loadAround(anchor.value, {
        postLoadingFn: scrollManager.move.toAnchor,
      });
    } else {
      loadLatest();
    }
  }, []);

  //
  // Loading older events (backwards in time)
  //
  useEffect(() => {
    if (scrollManager.currentWindowPosition.atTheTop) {
      const oldest = events.at(0);
      if (!hasOlder || !oldest || loadingTransition.current) {
        return;
      }
      loadBackwards(oldest.id, {
        // restore the current scroll position, because we're prepending new lines
        postLoadingFn: scrollManager.currentWindowPosition.createRestoreFn(),
      });
    }
  }, [scrollManager.currentWindowPosition.atTheTop]);

  //
  // Loading newer events (forwards in time)
  //
  useEffect(() => {
    if (scrollManager.currentWindowPosition.atTheBottom) {
      const newest = events.at(-1);
      if (!hasNewer || !newest || loadingTransition.current) {
        return;
      }
      loadForwards(newest.id);
    }
  }, [scrollManager.currentWindowPosition.atTheBottom]);

  //
  // Effect to keep ourselves stuck to the bottom (when following the stream)
  //
  useEffect(() => {
    if (loadingTransition.current?.variant === "backwards") {
      return; // don't stick to the bottom, if we're in the middle of paging upwards
    }
    if (isFollowingStream) {
      scrollManager.move.toTheBottom();
    }
  }, [events, isFollowingStream]);

  //
  // Lifecycle management; invoke post-loading hooks after the DOM has updated
  //
  const { registerElement: registerContainer } = useElementManager({
    mutationListener: {
      onMutation: (_, element) => {
        const postLoadingId = Number(element.getAttribute("data-loading-nonce"));
        if (postLoadingId === loadingTransition.current?.id) {
          loadingTransition.current.postLoadingHook?.();
          setLoadingNonce(0);
          loadingTransition.current = undefined;
        }
      },
      subscription: { attributes: true },
    },
  });

  return {
    registerContainer,
    lines,
    events,
    isLoading,
    loadingNonce,
    isFollowingStream,
    followStream,
  };
}

namespace Internal {
  export type LoadingVariant = "latest" | "forwards" | "backwards" | "around";

  export type LoadingTransition = {
    id: number;
    variant: LoadingVariant;
    postLoadingHook?: () => unknown;
  };

  export type PostLoadingOptions = {
    postLoadingFn?(): unknown;
  };

  export function requestOptions(type: LoadingVariant, cursorOrTimestamp?: string | Temporal.Instant): LogService.ListQuery {
    switch (type) {
      case "latest":
        return {};
      case "backwards":
        return { beforeExclusive: cursorOrTimestamp as string };
      case "forwards":
        return { afterExclusive: cursorOrTimestamp as string };
      case "around":
        return { at: cursorOrTimestamp?.toString() };
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
    registerContainer(container: HTMLElement): void;
    lines: Line[];
    events: ContainerEvent[];
    isLoading: boolean;
    loadingNonce: number;
    isFollowingStream: boolean;
    followStream(): void;
  };
}
