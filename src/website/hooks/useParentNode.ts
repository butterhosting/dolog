import { RowMarker } from "@/website/rendering/RowMarker";
import { useRef, useState } from "react";
import { ParentNode } from "./objects/ParentNode";
import { usePhysicalDOMElement } from "./usePhysicalDOMElement";

const EDGE_SLACK_PX = 24;

/**
 * `container` as in `the HTML container element` to the log lines
 */
export function useParentNode(): useParentNode.Result {
  const [atTheTop, setAtTheTop] = useState(false);
  const [atTheBottom, setAtTheBottom] = useState(true);
  // whether the last scroll left the reader at the bottom, for a decision made before the state above has caught up
  const scrolledToTheBottom = useRef(true);
  const bottomScrollTop = useRef(0);

  function reorient(container: HTMLElement): boolean {
    const atTheBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= EDGE_SLACK_PX;
    setAtTheTop(container.scrollTop <= EDGE_SLACK_PX);
    setAtTheBottom(atTheBottom);
    return atTheBottom;
  }

  // A scroll event arrives a frame after the scroll, by when a chatty container has grown the view past the
  // slack again; only a scrollTop below where the reader was last put at the bottom is the reader going up
  function scrolled(container: HTMLElement) {
    if (reorient(container)) {
      bottomScrollTop.current = container.scrollTop;
      scrolledToTheBottom.current = true;
    } else if (container.scrollTop < bottomScrollTop.current) {
      scrolledToTheBottom.current = false;
    }
  }

  const { elementRef, registerElement } = usePhysicalDOMElement({
    eventListeners: {
      scroll: (_, element) => scrolled(element),
    },
    mutationListener: {
      // content growing under a reader who stayed put is not the reader scrolling
      onMutation: (_, element) => reorient(element),
      subscription: { childList: true },
    },
  });

  return {
    registerParentNode: registerElement,
    parentNode: {
      currentScrollWindowPosition: {
        atTheTop,
        atTheBottom,
        isStillAtTheBottom: () => scrolledToTheBottom.current,
        createRestoreFn() {
          const container = elementRef.current;
          const heightBefore = container?.scrollHeight ?? 0;
          return () => {
            if (container) {
              container.scrollTop += container.scrollHeight - heightBefore;
              scrolled(container);
            }
          };
        },
      },
      events: {
        exists(eventId: string): boolean {
          return Boolean(Internal.findEventElement(elementRef.current, eventId));
        },
        isVisible(eventId: string): boolean {
          const container = elementRef.current;
          const element = Internal.findEventElement(container, eventId);
          return container !== undefined && element !== undefined && Internal.overlaps(element, container);
        },
        outermostVisibleIds() {
          const container = elementRef.current;
          if (!container) {
            return {};
          }
          const shown = Internal.findAll(container).filter((line) => Internal.overlaps(line, container));
          return {
            uppermostId: RowMarker.eventIdOf(shown.at(0)),
            bottommostId: RowMarker.eventIdOf(shown.at(-1)),
          };
        },
      },
      move: {
        toEvent(eventId: string, method?: "minimize_distance") {
          const element = Internal.findEventElement(elementRef.current, eventId);
          element?.scrollIntoView({ block: method === "minimize_distance" ? "nearest" : "center", behavior: "instant" });
        },
        toAnchor() {
          const element = Internal.findAnchorElement(elementRef.current);
          element?.scrollIntoView({ block: "center", behavior: "instant" });
        },
        toTheBottom() {
          const container = elementRef.current;
          if (container) {
            container.scrollTop = container.scrollHeight;
            scrolled(container);
          }
        },
      },
    },
  };
}

export namespace useParentNode {
  export type Result = {
    registerParentNode(container: HTMLElement | null): void;
    parentNode: ParentNode;
  };
}

namespace Internal {
  export function findAnchorElement(container: HTMLElement | undefined): HTMLElement | undefined {
    return container?.querySelector<HTMLElement>(RowMarker.ANCHORED_SELECTOR) ?? undefined; // at most 1
  }

  export function findEventElement(container: HTMLElement | undefined, eventId: string): HTMLElement | undefined {
    return container?.querySelector<HTMLElement>(RowMarker.querySelectorForEvent(eventId)) ?? undefined;
  }

  export function findAll(container: HTMLElement | undefined): HTMLElement[] {
    return [...(container?.querySelectorAll<HTMLElement>(RowMarker.EVENT_SELECTOR) || [])];
  }

  export function overlaps(line: HTMLElement, container: HTMLElement): boolean {
    const bounds = container.getBoundingClientRect();
    const rect = line.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom;
  }
}
