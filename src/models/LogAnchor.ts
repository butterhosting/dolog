import { Uuid } from "@/helpers/Uuid";
import { Temporal } from "@js-temporal/polyfill";

export type LogAnchor =
  | { kind: "id"; value: string } //
  | { kind: "timestamp"; value: Temporal.Instant };

export namespace LogAnchor {
  export function parse(raw: string | undefined): LogAnchor | undefined {
    if (!raw) {
      return undefined;
    }
    if (Uuid.check(raw)) {
      return { kind: "id", value: raw };
    }
    try {
      return { kind: "timestamp", value: Temporal.Instant.from(raw) };
    } catch {
      return undefined;
    }
  }

  export function value(anchor: LogAnchor): string {
    return anchor.value.toString();
  }
}
