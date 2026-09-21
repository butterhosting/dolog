export namespace RowMarker {
  const EVENT = "data-event";
  const ANCHORED = "data-anchored";
  // nothing in the app reads this one back; it is how the e2e suite tells a highlighted row from a plain one
  const MATCH = "data-match";

  export const EVENT_SELECTOR = `[${EVENT}]`;
  export const ANCHORED_SELECTOR = `[${ANCHORED}="true"]`;

  export type Match = "main_match" | "side_match";

  export function props({ eventId, isAnchored, match }: { eventId?: string; isAnchored?: boolean; match?: Match }) {
    return {
      [EVENT]: eventId,
      [ANCHORED]: isAnchored,
      [MATCH]: match,
    };
  }

  export function querySelectorForEvent(eventId: string): string {
    return `[${EVENT}="${CSS.escape(eventId)}"]`;
  }

  export function eventIdOf(element: HTMLElement | undefined): string | undefined {
    return element?.getAttribute(EVENT) ?? undefined;
  }
}
