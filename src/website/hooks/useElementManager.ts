import { ValueOf } from "@/types/ValueOf";
import { RefObject, useCallback, useEffect, useRef } from "react";

export function useElementManager(options: useElementManager.Options): useElementManager.Result {
  const optionsRef = useRef(options); // can only be set once
  const elementRef = useRef<HTMLElement>(undefined);

  const eventListersRef = useRef<Record<string, (event: any) => any>>({});
  const mutationObserverRef = useRef<{ observer: MutationObserver; boundFn: (mutations: MutationRecord[]) => any }>(undefined);

  const registerElement = useCallback((element: HTMLElement | null) => {
    if (element && !elementRef.current) {
      elementRef.current = element;
      Object.entries(optionsRef.current.eventListeners ?? {}).forEach(([property, listenerFn]) => {
        const boundListenerFn = (event: any) => listenerFn(event, element);
        eventListersRef.current[property] = boundListenerFn;
        type EventListenersMap = useElementManager.Options["eventListeners"];
        element.addEventListener(property as keyof EventListenersMap, boundListenerFn as ValueOf<EventListenersMap>);
      });
      if (optionsRef.current.mutationListener) {
        const handlerFn = optionsRef.current.mutationListener.onMutation;
        const boundHandlerFn = (mutations: MutationRecord[]) => handlerFn(mutations, element);
        mutationObserverRef.current = {
          observer: new MutationObserver(boundHandlerFn),
          boundFn: boundHandlerFn,
        };
        mutationObserverRef.current.observer.observe(element, optionsRef.current.mutationListener.subscription);
      }
    }
  }, []);

  const deregisterElement = useCallback(() => {
    if (elementRef.current) {
      const element = elementRef.current;
      Object.entries(optionsRef.current.eventListeners ?? {}).forEach(([property, listenerFn]) => {
        type EventListenersMap = useElementManager.Options["eventListeners"];
        element.removeEventListener(property as keyof EventListenersMap, listenerFn as ValueOf<EventListenersMap>);
      });
      if (mutationObserverRef.current) {
        mutationObserverRef.current.observer.disconnect();
      }
    }
  }, []);

  useEffect(() => () => deregisterElement(), []);

  return {
    elementRef,
    registerElement,
  };
}

namespace useElementManager {
  export type Options = {
    eventListeners?: {
      [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K], element: HTMLElement) => unknown;
    };
    mutationListener?: {
      subscription?: MutationObserverInit;
      onMutation: (mutations: MutationRecord[], element: HTMLElement) => unknown;
    };
  };

  export type Result = {
    registerElement(element: HTMLElement | null): void;
    elementRef: RefObject<HTMLElement | undefined>;
  };
}
