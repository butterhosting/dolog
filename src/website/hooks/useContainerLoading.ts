import { ContainerEvent } from "@/models/ContainerEvent";
import { LogService } from "@/services/LogService";
import { Temporal } from "@js-temporal/polyfill";
import { Dispatch, RefObject, SetStateAction, useLayoutEffect, useRef, useState } from "react";
import { LogClient } from "../clients/LogClient";
import { useLogFilter } from "./useLogFilter";
import { useRegistry } from "./useRegistry";

export function useContainerLoading({ containerId, filter }: useContainerLoading.Options): useContainerLoading.Result {
  const logClient = useRegistry(LogClient);

  const [events, setEvents] = useState<ContainerEvent[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [loadingNonce, setLoadingNonce] = useState(0);

  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [landedAt, setLandedAt] = useState<string>();

  const activeLoadVariant = useRef<useContainerLoading.Variant>(undefined);
  const activeLoadState = useRef<Internal.LoadingState>(undefined);

  function isActivelyLoading(): boolean {
    return Boolean(activeLoadVariant.current || activeLoadState.current);
  }
  function clearActiveLoad() {
    activeLoadVariant.current = undefined;
    activeLoadState.current = undefined;
  }

  const requestLogs: Internal.LoadingFn = (
    variant: useContainerLoading.Variant,
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
    variant: useContainerLoading.Variant,
    cursorOrTimestamp?: string | Temporal.Instant,
    options?: Internal.LoadingOptions,
  ) {
    queue.current = queue.current.then(() => performLoad(variant, cursorOrTimestamp, options)).catch((error) => console.error(error));
    await queue.current;
  }
  async function performLoad(
    variant: useContainerLoading.Variant,
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
    const { data, hasNewer, hasOlder, landedAt } = await logClient
      .list(containerId, {
        ...requestOptions,
        ...useLogFilter.serializeForServer(filter),
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

  return {
    events,
    setEvents,
    loadingRef: activeLoadVariant,
    isLoading,
    hasNewer,
    hasOlder,
    landedAt,
    requestLogs,
  };
}

namespace Internal {
  export type LoadingFn = useContainerLoading.Result["requestLogs"];
  export type LoadingOptions = {
    postDOM?: () => unknown;
  };

  export type LoadingState = {
    nonce: number;
    postDOM?: () => unknown;
  };
}

export namespace useContainerLoading {
  export type Variant = "latest" | "forwards" | "backwards" | "around";
  export type Options = {
    containerId: string;
    filter: useLogFilter.ClientFilter;
  };
  export type Result = {
    events: ContainerEvent[];
    setEvents: Dispatch<SetStateAction<ContainerEvent[]>>; // also used by the livestream
    loadingRef: RefObject<Variant | undefined>;
    isLoading: boolean;
    hasNewer: boolean;
    hasOlder: boolean;
    landedAt?: string;
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
