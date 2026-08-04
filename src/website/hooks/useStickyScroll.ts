import { RefObject, useCallback, useEffect, useRef, useState } from "react";

/** How far off the bottom still counts as being at it, since scroll positions are fractional. */
const BOTTOM_SLACK_PX = 24;

/**
 * Keeps a scroll container pinned to the bottom as content arrives, and lets go the moment the
 * reader scrolls up -- because someone reading history does not want to be yanked away by a line
 * arriving underneath them.
 *
 * There is no way to distinguish a user's scroll from a programmatic one, so instead of guessing we
 * simply re-measure after every scroll: if the viewport is at the bottom we are stuck, and if it is
 * not we are not. Scrolling back down by hand re-sticks it, which is what people expect.
 */
export function useStickyScroll<T extends HTMLElement>(dependency: unknown, pinToBottom = true): useStickyScroll.Result<T> {
  const ref = useRef<T>(null);
  const [stuck, setStuck] = useState(true);

  const isAtBottom = (element: T) => element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX;

  const scrollToBottom = useCallback(() => {
    const element = ref.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
      setStuck(true);
    }
  }, []);

  const onScroll = useCallback(() => {
    const element = ref.current;
    if (element) {
      setStuck(isAtBottom(element));
    }
  }, []);

  /**
   * Runs after the browser has painted the new content, so `scrollHeight` already accounts for it.
   *
   * `pinToBottom` is false while the view is parked in history, where the bottom of the window is
   * just the far edge of what was fetched and being dragged to it would throw away the position
   * that was navigated to.
   */
  useEffect(() => {
    const element = ref.current;
    if (element && stuck && pinToBottom) {
      element.scrollTop = element.scrollHeight;
    }
  }, [dependency, stuck, pinToBottom]);

  return { ref, stuck, onScroll, scrollToBottom };
}

export namespace useStickyScroll {
  export type Result<T extends HTMLElement> = {
    ref: RefObject<T | null>;
    /** False once the reader has scrolled away, which is when to offer them a way back. */
    stuck: boolean;
    onScroll: () => void;
    scrollToBottom: () => void;
  };
}
