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
      oldest?: string;
      newest?: string;
    };
  };
  move: {
    toEvent(eventId: string): unknown;
    toAnchor(): unknown;
    toTheBottom(): unknown;
  };
};
