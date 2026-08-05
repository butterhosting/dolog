import { Temporal } from "@js-temporal/polyfill";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

type Props = {
  current?: Temporal.Instant;
  close: () => void;
  done: (instant: Temporal.Instant) => void;
};

/**
 * One field, holding a bare wall clock read as UTC -- the same clock the timestamps beside every log
 * line are printed in, so what is typed here and what is read there are the same thing.
 */
export function JumpModal({ current, close, done }: Props) {
  const [value, setValue] = useState(current ? Internal.toField(current) : "");
  const instant = Internal.parse(value);
  // read off the clock once, so a modal left open overnight cannot relabel its own buttons
  const presets = useMemo(() => Internal.presets(), []);

  return (
    <Modal isOpen issueCloseRequestWhenClickingBackdrop issueCloseRequestWhenPressingEscape onCloseRequest={close} className="p-6">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (instant) {
            done(instant);
          }
        }}
      >
        <div className="flex flex-wrap gap-2">
          {presets.map(({ label, at }) => (
            <button
              key={label}
              type="button"
              onClick={() => setValue(at)}
              className={clsx(
                "rounded-full border px-3 py-1 text-xs cursor-pointer transition-colors",
                value === at
                  ? "border-c-accent bg-c-accent text-white"
                  : "border-c-dark-half/30 text-c-dark-half hover:border-c-accent hover:text-c-accent",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          autoFocus
          type="datetime-local"
          step="1"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="rounded-lg border border-c-dark-half/40 px-3 py-2 font-mono text-sm outline-none focus:border-c-accent"
        />

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" theme="neutral" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!instant}>
            Jump
          </Button>
        </div>
      </form>
    </Modal>
  );
}

namespace Internal {
  /** ISO numbering, so index 0 is Monday -- what `dayOfWeek` returns as 1. */
  const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  /**
   * The last seven days, named the way someone would say them out loud: the two nearest by their
   * relation to now, the rest by weekday -- which only reads unambiguously because it stops before
   * wrapping around to today's own name a week ago.
   *
   * Each lands on midnight, so the day is entered at its start rather than at whatever time happened
   * to be in the field.
   */
  export function presets(): { label: string; at: string }[] {
    const today = Temporal.Now.plainDateISO("UTC");
    return Array.from({ length: 7 }, (_, back) => {
      const date = today.subtract({ days: back });
      const label = back === 0 ? "today" : back === 1 ? "yesterday" : WEEKDAYS[date.dayOfWeek - 1]!;
      return { label, at: `${date.toString()}T00:00:00` };
    });
  }

  /** `datetime-local` speaks a bare wall clock, so the zone is dropped rather than converted. */
  export function toField(instant: Temporal.Instant): string {
    return instant.toString({ smallestUnit: "second" }).replace("Z", "");
  }

  /** The same trade in reverse -- and the seconds come back optional, so they are filled in. */
  export function parse(value: string): Temporal.Instant | null {
    if (!value) {
      return null;
    }
    try {
      return Temporal.Instant.from(`${value.length === "YYYY-MM-DDTHH:mm".length ? `${value}:00` : value}Z`);
    } catch {
      return null;
    }
  }
}
