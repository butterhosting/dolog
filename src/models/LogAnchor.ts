import { Uuid } from "@/helpers/Uuid";
import { Temporal } from "@js-temporal/polyfill";

export type LogAnchor =
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

export namespace LogAnchor {
  export function forId(id: string): LogAnchor {
    return {
      type: "id",
      value: id,
      serialize: () => id,
    };
  }
  export function forTimestamp(t: Temporal.Instant): LogAnchor {
    return {
      type: "timestamp",
      value: t,
      serialize: () => t.toString(),
    };
  }
  export function parse(raw: string | undefined): LogAnchor | undefined {
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
