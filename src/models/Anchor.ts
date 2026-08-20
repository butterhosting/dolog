import { Uuid } from "@/models/Uuid";
import { Temporal } from "@js-temporal/polyfill";

export type Anchor =
  | {
      type: "id";
      value: string;
      serialize: () => string;
    }
  | {
      type: "timestamp";
      value: Temporal.Instant;
      serialize: () => string;
    };

export namespace Anchor {
  export function forId(id: string): Anchor {
    return {
      type: "id",
      value: id,
      serialize: () => id,
    };
  }
  export function forTimestamp(t: Temporal.Instant): Anchor {
    return {
      type: "timestamp",
      value: t,
      serialize: () => t.toString(),
    };
  }
  export function parse(raw: string | undefined): Anchor | undefined {
    if (!raw) {
      return undefined;
    }
    if (Uuid.check(raw)) {
      return {
        type: "id",
        value: raw,
        serialize: () => raw,
      };
    }
    try {
      return {
        type: "timestamp",
        value: Temporal.Instant.from(raw),
        serialize: () => raw,
      };
    } catch {
      return undefined;
    }
  }
}
