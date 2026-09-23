export type ParentNode = {
  currentScrollWindowPosition: {
    atTheTop: boolean;
    atTheBottom: boolean;
    /** `atTheBottom` is a render behind; this is where the last scroll actually left the view */
    isStillAtTheBottom(): boolean;
    createRestoreFn(): () => unknown;
  };
  events: {
    exists(eventId: string): boolean;
    isVisible(eventId: string): boolean;
    outermostVisibleIds(): {
      uppermostId?: string;
      bottommostId?: string;
    };
  };
  move: {
    toEvent(eventId: string, method?: "minimize_distance"): unknown;
    toAnchor(): unknown;
    toTheBottom(): unknown;
  };
};
