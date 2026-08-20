import { useState } from "react";
import { useElementManager } from "./useElementManager";
import { PhysicalDOMContainer } from "./objects/PhysicalDOMContainer";

const EDGE_SLACK_PX = 24;

export function usePhysicalDOMContainer(): usePhysicalDOMContainer.Result {
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
    physicalDOMContainer: {
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
          return Internal.eventElement(containerRef.current, eventId) !== null;
        },
        isVisible(eventId: string): boolean {
          const container = containerRef.current;
          const element = Internal.eventElement(container, eventId);
          return container !== undefined && element !== null && Internal.overlaps(element, container);
        },
        outermostVisibleIds() {
          const container = containerRef.current;
          if (!container) {
            return {};
          }
          const shown = [...container.querySelectorAll<HTMLElement>("[data-event]")].filter((line) => Internal.overlaps(line, container));
          return {
            oldest: shown.at(0)?.dataset.event,
            newest: shown.at(-1)?.dataset.event,
          };
        },
      },
      move: {
        toEvent(eventId: string) {
          Internal.eventElement(containerRef.current, eventId)?.scrollIntoView({ block: "center", behavior: "instant" });
        },
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
    },
  };
}

export namespace usePhysicalDOMContainer {
  export type Result = {
    registerContainer(container: HTMLElement | null): void;
    physicalDOMContainer: PhysicalDOMContainer;
  };
}

namespace Internal {
  export function eventElement(container: HTMLElement | undefined, eventId: string): HTMLElement | null {
    return container?.querySelector<HTMLElement>(`[data-event="${CSS.escape(eventId)}"]`) ?? null;
  }

  export function overlaps(line: HTMLElement, container: HTMLElement): boolean {
    const bounds = container.getBoundingClientRect();
    const rect = line.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom;
  }
}
