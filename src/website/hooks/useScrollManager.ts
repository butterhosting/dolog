import { useEffect, useRef, useState } from "react";

const EDGE_SLACK_PX = 24;

export function useScrollManager(): useScrollManager.Result {
  const containerRef = useRef<{
    element: HTMLElement;
    scrollListener: (event: Event) => unknown;
    contentObserver: MutationObserver;
  }>(undefined);

  const [atTheTop, setAtTheTop] = useState(false);
  const [atTheBottom, setAtTheBottom] = useState(true);

  function reorient(element: HTMLElement) {
    setAtTheTop(element.scrollTop <= EDGE_SLACK_PX);
    setAtTheBottom(element.scrollHeight - element.scrollTop - element.clientHeight <= EDGE_SLACK_PX);
  }

  function registerContainer(element: HTMLElement) {
    if (!containerRef.current) {
      containerRef.current = {
        element,
        scrollListener: () => reorient(element),
        contentObserver: new MutationObserver(() => reorient(element)),
      };
      containerRef.current.element.addEventListener("scroll", containerRef.current.scrollListener);
      containerRef.current.contentObserver.observe(element, { childList: true });
    }
  }
  function deregisterContainer() {
    containerRef.current?.element.removeEventListener("scroll", containerRef.current.scrollListener);
    containerRef.current?.contentObserver.disconnect();
  }
  useEffect(() => () => deregisterContainer(), []);

  return {
    registerContainer,
    currentWindowPosition: {
      atTheTop,
      atTheBottom,
      createRestoreFn() {
        const element = containerRef.current?.element;
        const heightBefore = element?.scrollHeight ?? 0;
        return () => {
          if (element) {
            element.scrollTop += element.scrollHeight - heightBefore;
            reorient(element);
          }
        };
      },
    },
    move: {
      toTheBottom() {
        const element = containerRef.current?.element;
        if (element) {
          element.scrollTop = element.scrollHeight;
          reorient(element);
        }
      },
    },
  };
}

export namespace useScrollManager {
  export type Result = {
    registerContainer: (container: HTMLElement) => void;
    currentWindowPosition: {
      atTheTop: boolean;
      atTheBottom: boolean;
      createRestoreFn: () => () => unknown;
    };
    move: {
      toTheBottom: () => unknown;
    };
  };
}
