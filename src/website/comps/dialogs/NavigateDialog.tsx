import { Temporal } from "@js-temporal/polyfill";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { Button } from "../basics/Button";
import { Dialog } from "../basics/Dialog";

type Props = {
  current?: Temporal.Instant;
  close: () => void;
  done: (instant: Temporal.Instant) => void;
};

/**
 * One field, holding a bare wall clock read as UTC -- the same clock the timestamps beside every log
 * line are printed in, so what is typed here and what is read there are the same thing.
 */
export function NavigateDialog({ current, close, done }: Props) {
  /**
   * Split in two on purpose. A date wants the calendar a native picker gives it -- "the 3rd" is
   * something you point at -- while a time is something you type, and a combined control makes you
   * tab through a calendar to reach it. The time therefore starts at midnight, which is the answer
   * most of the time and the one the presets assume.
   */
  const [date, setDate] = useState(current ? Internal.toDateField(current) : "");
  const [time, setTime] = useState(current ? Internal.toTimeField(current) : Internal.MIDNIGHT);
  const instant = Internal.parse(date, time);
  // read off the clock once, so a modal left open overnight cannot relabel its own buttons
  const presets = useMemo(() => Internal.presets(), []);

  return (
    <Dialog isOpen issueCloseRequestWhenClickingBackdrop issueCloseRequestWhenPressingEscape onCloseRequest={close} className="p-6">
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
              onClick={() => {
                setDate(at);
                // a preset names a day, so it enters it at the start rather than at whatever
                // time was left in the field from a previous answer
                setTime(Internal.MIDNIGHT);
              }}
              className={clsx(
                "rounded-full border px-3 py-1 text-xs cursor-pointer transition-colors",
                date === at && time === Internal.MIDNIGHT
                  ? "border-c-accent bg-c-accent text-white"
                  : "border-c-dark-half/30 text-c-dark-half hover:border-c-accent hover:text-c-accent",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <input
            autoFocus
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="flex-1 rounded-lg border border-c-dark-half/40 px-3 py-2 font-mono text-sm outline-none focus:border-c-accent"
          />
          <input
            type="text"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            placeholder={Internal.MIDNIGHT}
            aria-label="time"
            className={clsx(
              "w-32 rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:border-c-accent",
              // only complains once there is a date to go with it, so an empty form is not an error
              date && !instant ? "border-c-error text-c-error" : "border-c-dark-half/40",
            )}
          />
        </div>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" theme="neutral" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!instant}>
            Jump
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

namespace Internal {
  /** ISO numbering, so index 0 is Monday -- what `dayOfWeek` returns as 1. */
  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /**
   * The last five days. The two nearest are named by their relation to now, which is how anyone
   * would say them; the rest carry their date beside the weekday, because a bare "tuesday" leaves
   * the reader counting backwards to work out which tuesday is meant.
   *
   * Each lands on midnight, so the day is entered at its start rather than at whatever time happened
   * to be in the field.
   */
  export function presets(): { label: string; at: string }[] {
    const today = Temporal.Now.plainDateISO("UTC");
    return Array.from({ length: 5 }, (_, back) => {
      const date = today.subtract({ days: back });
      const dated = `${WEEKDAYS[date.dayOfWeek - 1]!}, ${MONTHS[date.month - 1]!} ${date.day}`;
      const label = back === 0 ? "Today" : back === 1 ? "Yesterday" : dated;
      return { label, at: date.toString() };
    });
  }

  /** What an untouched time field says, and what a preset puts back into it. */
  export const MIDNIGHT = "00:00:00";

  /** Both fields speak a bare wall clock, so the zone is dropped rather than converted. */
  export function toDateField(instant: Temporal.Instant): string {
    return instant.toString().slice(0, "YYYY-MM-DD".length);
  }

  export function toTimeField(instant: Temporal.Instant): string {
    return instant.toString({ smallestUnit: "second" }).slice("YYYY-MM-DDT".length).replace("Z", "");
  }

  /**
   * The two fields back into one instant. Seconds are optional so `09:30` is a fair thing to type,
   * and an empty time is read as midnight rather than as a mistake -- that is what the placeholder
   * promises when the field is left alone.
   */
  export function parse(date: string, time: string): Temporal.Instant | null {
    if (!date) {
      return null;
    }
    const typed = time.trim() || MIDNIGHT;
    const filled = typed.length === "HH:mm".length ? `${typed}:00` : typed;
    try {
      return Temporal.Instant.from(`${date}T${filled}Z`);
    } catch {
      return null;
    }
  }
}
