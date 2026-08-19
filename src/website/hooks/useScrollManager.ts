import { useState } from "react";
import { useElementManager } from "./useElementManager";

const EDGE_SLACK_PX = 24;

export function useScrollManager(): useScrollManager.Result {
  const [atTheTop, setAtTheTop] = useState(false);
  const [atTheBottom, setAtTheBottom] = useState(true);

  function reorient(container: HTMLElement) {
    setAtTheTop(container.scrollTop <= EDGE_SLACK_PX);
    setAtTheBottom(container.scrollHeight - container.scrollTop - container.clientHeight <= EDGE_SLACK_PX);
  }

  const { elementRef: containerRef, registerElement: registerContainer } = useElementManager({
    eventListeners: {
      scroll: (_, element) => reorient(element),
    },
    mutationListener: {
      onMutation: (_, element) => reorient(element),
      subscription: { childList: true },
    },
  });

  return {
    registerContainer,
    currentWindowPosition: {
      atTheTop,
      atTheBottom,
      createRestoreFn() {
        const container = containerRef.current;
        const heightBefore = container?.scrollHeight ?? 0;
        return () => {
          if (container) {
            container.scrollTop += container.scrollHeight - heightBefore;
            reorient(container);
          }
        };
      },
    },
    move: {
      toAnchor() {
        const container = containerRef.current;
        if (container) {
          const anchorElement = container.querySelector('[data-anchored="true"]'); // at most 1
          anchorElement?.scrollIntoView({ block: "center", behavior: "instant" });
        }
      },
      toTheBottom() {
        const container = containerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
          reorient(container);
        }
      },
    },
  };
}

export namespace useScrollManager {
  export type Result = {
    registerContainer(container: HTMLElement): void;
    currentWindowPosition: {
      atTheTop: boolean;
      atTheBottom: boolean;
      createRestoreFn(): () => unknown;
    };
    move: {
      toAnchor(): unknown;
      toTheBottom(): unknown;
    };
  };
}
