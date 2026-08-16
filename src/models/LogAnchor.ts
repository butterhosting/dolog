import { Uuid } from "@/helpers/Uuid";
import { Temporal } from "@js-temporal/polyfill";

export type LogAnchor =
  | { kind: "id"; value: string } //
  | { kind: "timestamp"; value: Temporal.Instant };

export namespace LogAnchor {
  export function parse(raw: string | null | undefined): LogAnchor | null {
    if (!raw) {
      return null;
    }
    if (Uuid.check(raw)) {
      return { kind: "id", value: raw };
    }
    try {
      return { kind: "timestamp", value: Temporal.Instant.from(raw) };
    } catch {
      return null;
    }
  }

  export function value(anchor: LogAnchor): string {
    return anchor.value.toString();
  }
}
