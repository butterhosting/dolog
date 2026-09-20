import { ContainerEvent } from "@/models/ContainerEvent";
import { LogService } from "@/services/LogService";
import { Temporal } from "@js-temporal/polyfill";
import { RefObject, useLayoutEffect, useRef, useState } from "react";
import { LogClient } from "../clients/LogClient";
import { useRegistry } from "./basics/useRegistry";
import { ClientFilter } from "./objects/ClientFilter";
import { useFilter } from "./useFilter";

/** How far the window may grow while tailing, before the oldest lines are let go of. */
const MAX_WINDOW_SIZE = 300;

export function useLoading({ svcId, filter }: useLoading.Options): useLoading.Result {
  const logClient = useRegistry(LogClient);
  const { DOLOG_TIMEZONE } = useRegistry("env");

  const [events, setEvents] = useState<ContainerEvent[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [loadingNonce, setLoadingNonce] = useState(0);

  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);

  const activeLoadVariant = useRef<useLoading.Variant>(undefined);
  const activeLoadState = useRef<Internal.LoadingState>(undefined);

  function isActivelyLoading(): boolean {
    return Boolean(activeLoadVariant.current || activeLoadState.current);
  }
  function clearActiveLoad() {
    activeLoadVariant.current = undefined;
    activeLoadState.current = undefined;
  }

  const requestLogs: Internal.LoadingFn = (
    variant: useLoading.Variant,
    arg1?: Internal.LoadingOptions | string | Temporal.Instant,
    arg2?: Internal.LoadingOptions,
  ): Promise<void> => {
    switch (variant) {
      case "latest":
        return dispatchLoad(variant, undefined, arg1 as Internal.LoadingOptions | undefined);
      case "forwards":
      case "backwards":
        if (isActivelyLoading()) {
          console.warn(`Loading ${variant} cancelled; transition already in progress`);
          return Promise.resolve();
        }
        return dispatchLoad(variant, arg1 as string, arg2 as Internal.LoadingOptions | undefined);
      case "around":
        return dispatchLoad(variant, arg1 as string | Temporal.Instant, arg2 as Internal.LoadingOptions | undefined);
    }
  };

  const queue = useRef(Promise.resolve());
  async function dispatchLoad(
    variant: useLoading.Variant,
    cursorOrTimestamp?: string | Temporal.Instant,
    options?: Internal.LoadingOptions,
  ) {
    queue.current = queue.current.then(() => performLoad(variant, cursorOrTimestamp, options)).catch((error) => console.error(error));
    await queue.current;
  }
  async function performLoad(
    variant: useLoading.Variant,
    cursorOrTimestamp?: string | Temporal.Instant,
    options?: Internal.LoadingOptions,
  ) {
    setLoading(true);
    const nonce = Math.random();
    activeLoadVariant.current = variant;
    activeLoadState.current = { nonce, postDOM: options?.postDOM };

    let requestOptions: LogService.ListQuery;
    switch (variant) {
      case "latest": {
        requestOptions = {};
        break;
      }
      case "backwards": {
        requestOptions = { beforeExclusive: cursorOrTimestamp as string };
        break;
      }
      case "forwards": {
        requestOptions = { afterExclusive: cursorOrTimestamp as string };
        break;
      }
      case "around": {
        requestOptions = { at: cursorOrTimestamp?.toString() };
        break;
      }
    }
    const { data, hasNewer, hasOlder } = await logClient
      .list(svcId, {
        ...requestOptions,
        ...useFilter.serializeForServer(filter, DOLOG_TIMEZONE),
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
        setEvents((existingEvents) => ContainerEvent.deduplicate([...data, ...existingEvents])); // websocket race
        setHasOlder(hasOlder);
        break;
      }
      case "forwards": {
        setEvents((existingEvents) => ContainerEvent.deduplicate([...existingEvents, ...data])); // websocket race
        setHasNewer(hasNewer);
        break;
      }
      default: {
        variant satisfies never;
      }
    }
    setLoadingNonce(nonce);
  }

  //
  // Lifecycle management; invoke post-loading hooks after the DOM has updated
  //
  // We're using `useLayoutEffect` here because it's 1% better, since it's guaranteed
  // to run before a repaint (but always after DOM manipulation). From its docs:
  //
  //    > The signature is identical to useEffect, but it fires synchronously after all DOM mutations.
  //    > Use this to read layout from the DOM and synchronously re-render.
  //
  useLayoutEffect(() => {
    if (activeLoadState.current?.nonce === loadingNonce) {
      activeLoadState.current.postDOM?.();
      clearActiveLoad();
    }
  }, [loadingNonce]);

  function appendEvent(event: ContainerEvent): boolean {
    if (isActivelyLoading()) {
      return false;
    }
    // appended rather than sorted in: the stream delivers a container's lines in the order they were
    // logged, which is the order their ids sort in
    setEvents((current) => [...current, event].slice(-MAX_WINDOW_SIZE));
    return true;
  }

  return {
    events,
    appendEvent,
    loadingRef: activeLoadVariant,
    isLoading,
    hasNewer,
    hasOlder,
    requestLogs,
  };
}

namespace Internal {
  export type LoadingFn = useLoading.Result["requestLogs"];
  export type LoadingOptions = {
    postDOM?: () => unknown;
  };

  export type LoadingState = {
    nonce: number;
    postDOM?: () => unknown;
  };
}

export namespace useLoading {
  export type Variant = "latest" | "forwards" | "backwards" | "around";
  export type Options = {
    svcId: string;
    filter: ClientFilter;
  };
  export type Result = {
    events: ContainerEvent[];
    appendEvent(event: ContainerEvent): boolean;
    loadingRef: RefObject<Variant | undefined>;
    isLoading: boolean;
    hasNewer: boolean;
    hasOlder: boolean;
    requestLogs(variant: Extract<Variant, "latest">, opts?: Internal.LoadingOptions): Promise<void>;
    requestLogs(variant: Extract<Variant, "forwards">, cursor: string, opts?: Internal.LoadingOptions): Promise<void>;
    requestLogs(variant: Extract<Variant, "backwards">, cursor: string, opts?: Internal.LoadingOptions): Promise<void>;
    requestLogs(
      variant: Extract<Variant, "around">,
      cursorOrTimestamp: string | Temporal.Instant,
      opts?: Internal.LoadingOptions,
    ): Promise<void>;
  };
}
