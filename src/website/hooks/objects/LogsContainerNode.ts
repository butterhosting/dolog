export type LogsContainerNode = {
  currentScrollWindowPosition: {
    atTheTop: boolean;
    atTheBottom: boolean;
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
