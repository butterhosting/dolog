import { useState } from "react";
import { LogsContainerNode } from "./objects/LogsContainerNode";
import { usePhysicalDOMElement } from "./usePhysicalDOMElement";

const EDGE_SLACK_PX = 24;

export function useLogsContainerNode(): useLogsContainerNode.Result {
  const [atTheTop, setAtTheTop] = useState(false);
  const [atTheBottom, setAtTheBottom] = useState(true);

  function reorient(container: HTMLElement) {
    setAtTheTop(container.scrollTop <= EDGE_SLACK_PX);
    setAtTheBottom(container.scrollHeight - container.scrollTop - container.clientHeight <= EDGE_SLACK_PX);
  }

  const { elementRef: containerRef, registerElement } = usePhysicalDOMElement({
    eventListeners: {
      scroll: (_, element) => reorient(element),
    },
    mutationListener: {
      onMutation: (_, element) => reorient(element),
      subscription: { childList: true },
    },
  });

  return {
    register: registerElement,
    logsContainerNode: {
      currentScrollWindowPosition: {
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
      events: {
        exists(eventId: string): boolean {
          return Boolean(Internal.findEventElement(containerRef.current, eventId));
        },
        isVisible(eventId: string): boolean {
          const container = containerRef.current;
          const element = Internal.findEventElement(container, eventId);
          return container !== undefined && element !== undefined && Internal.overlaps(element, container);
        },
        outermostVisibleIds() {
          const container = containerRef.current;
          if (!container) {
            return {};
          }
          const shown = Internal.findAll(container).filter((line) => Internal.overlaps(line, container));
          return {
            topOfScreenId: shown.at(0)?.dataset.event,
            bottomOfScreenId: shown.at(-1)?.dataset.event,
          };
        },
      },
      move: {
        toEvent(eventId: string) {
          const element = Internal.findEventElement(containerRef.current, eventId);
          element?.scrollIntoView({ block: "center", behavior: "instant" });
        },
        toAnchor() {
          const element = Internal.findAnchorElement(containerRef.current);
          element?.scrollIntoView({ block: "center", behavior: "instant" });
        },
        toTheBottom() {
          const container = containerRef.current;
          if (container) {
            container.scrollTop = container.scrollHeight;
            reorient(container);
          }
        },
      },
    },
  };
}

export namespace useLogsContainerNode {
  export type Result = {
    register(container: HTMLElement | null): void;
    logsContainerNode: LogsContainerNode;
  };
}

namespace Internal {
  export function findAnchorElement(container: HTMLElement | undefined): HTMLElement | undefined {
    return container?.querySelector('[data-anchored="true"]') ?? undefined; // at most 1
  }

  export function findEventElement(container: HTMLElement | undefined, eventId: string): HTMLElement | undefined {
    return container?.querySelector<HTMLElement>(`[data-event="${CSS.escape(eventId)}"]`) ?? undefined;
  }

  export function findAll(container: HTMLElement | undefined): HTMLElement[] {
    return [...(container?.querySelectorAll<HTMLElement>("[data-event]") || [])];
  }

  export function overlaps(line: HTMLElement, container: HTMLElement): boolean {
    const bounds = container.getBoundingClientRect();
    const rect = line.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom;
  }
}
