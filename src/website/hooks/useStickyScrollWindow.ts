import { RefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a scroll container pinned to the bottom as content arrives, and lets go the moment the
 * reader scrolls up -- because someone reading history does not want to be yanked away by a line
 * arriving underneath them.
 *
 * There is no way to distinguish a user's scroll from a programmatic one, so instead of guessing we
 * simply re-measure after every scroll: if the viewport is at the bottom we are stuck, and if it is
 * not we are not. Scrolling back down by hand re-sticks it, which is what people expect.
 */
export function useStickyScrollWindow<T extends HTMLElement>(dependency: unknown, pinToBottom = true): useStickyScrollWindow.Result<T> {
  const scrollWindowRef = useRef<T>(null);
  const [atBottom, setAtBottom] = useState(true);

  // one of the two callbacks in the app that has to keep its identity: an effect depends on it, and
  // a fresh one every render would re-run that effect every render
  const scrollToBottom = useCallback(() => {
    const element = scrollWindowRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
      setAtBottom(true);
    }
  }, []);

  /**
   * Hands back what it just measured, as well as storing it.
   *
   * A scroll handler runs before React has re-rendered, so the state below is one scroll event stale
   * at exactly the moment a handler would ask it -- and a handler that has to decide something *now*
   * would otherwise have to measure the container a second time to find out what this call already
   * knows.
   */
  function onScroll() {
    const element = scrollWindowRef.current;
    if (!element) {
      return false;
    }
    const nowAtBottom = Internal.isAtBottom(element);
    setAtBottom(nowAtBottom);
    return nowAtBottom;
  }

  /**
   * Runs after the browser has painted the new content, so `scrollHeight` already accounts for it.
   *
   * `pinToBottom` is false while the view is parked in history, where the bottom of the window is
   * just the far edge of what was fetched and being dragged to it would throw away the position
   * that was navigated to.
   */
  useEffect(() => {
    const element = scrollWindowRef.current;
    if (element && atBottom && pinToBottom) {
      element.scrollTop = element.scrollHeight;
    }
  }, [dependency, atBottom, pinToBottom]);

  return { scrollWindowRef, atBottom, onScroll, scrollToBottom };
}

namespace Internal {
  const BOTTOM_SLACK_PX = 24; // How far off the bottom still counts as being at it, since scroll positions are fractional
  export function isAtBottom(element: HTMLElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX;
  }
}

export namespace useStickyScrollWindow {
  export type Result<T extends HTMLElement> = {
    scrollWindowRef: RefObject<T | null>;
    /**
     * Whether the container was at its bottom as of the last render -- false once the reader has
     * scrolled away, which is when to offer them a way back.
     *
     * Read this while rendering. Inside a scroll handler, take the answer {@link onScroll} returns
     * instead: that one is measured rather than remembered.
     */
    atBottom: boolean;
    /** Measures whether the container is at its bottom, stores the answer, and returns it. */
    onScroll: () => boolean;
    scrollToBottom: () => void;
  };
}
