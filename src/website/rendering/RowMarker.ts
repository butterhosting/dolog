export namespace RowMarker {
  const EVENT = "data-event";
  const ANCHORED = "data-anchored";

  export const EVENT_SELECTOR = `[${EVENT}]`;
  export const ANCHORED_SELECTOR = `[${ANCHORED}="true"]`;

  export function props({ eventId, isAnchored }: { eventId?: string; isAnchored?: boolean }) {
    return {
      [EVENT]: eventId,
      [ANCHORED]: isAnchored,
    };
  }

  export function querySelectorForEvent(eventId: string): string {
    return `[${EVENT}="${CSS.escape(eventId)}"]`;
  }

  export function eventIdOf(element: HTMLElement | undefined): string | undefined {
    return element?.getAttribute(EVENT) ?? undefined;
  }
}
