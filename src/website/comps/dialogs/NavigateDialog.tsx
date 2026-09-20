import { Timezone } from "@/helpers/Timezone";
import { useRegistry } from "@/website/hooks/basics/useRegistry";
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

export function NavigateDialog({ current, close, done }: Props) {
  const { DOLOG_TIMEZONE } = useRegistry("env");

  const [date, setDate] = useState(current ? Internal.toDateField(current, DOLOG_TIMEZONE) : "");
  const [time, setTime] = useState(current ? Internal.toTimeField(current, DOLOG_TIMEZONE) : Internal.MIDNIGHT);
  const instant = Internal.parse(date, time, DOLOG_TIMEZONE);

  const presets = useMemo(() => Internal.presets(DOLOG_TIMEZONE), []);

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
                  ? "border-c-accent bg-c-accent text-c-shell"
                  : "border-c-chip-edge bg-c-chip text-white hover:border-c-accent hover:text-c-accent",
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
            className="flex-1 rounded-lg border border-c-chip-edge bg-c-chip px-3 py-2 text-sm outline-none focus:border-c-accent"
          />
          <input
            type="text"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            placeholder={Internal.MIDNIGHT}
            aria-label="time"
            className={clsx(
              "w-32 rounded-lg border bg-c-chip px-3 py-2 text-sm outline-none focus:border-c-accent",
              // only complains once there is a date to go with it, so an empty form is not an error
              date && !instant ? "border-c-error text-c-error" : "border-c-chip-edge",
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
  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  export function presets(timezone: string): { label: string; at: string }[] {
    const today = Timezone.dayOf(Temporal.Now.instant(), timezone);
    return Array.from({ length: 5 }, (_, back) => {
      const date = today.subtract({ days: back });
      const dated = `${WEEKDAYS[date.dayOfWeek - 1]!}, ${MONTHS[date.month - 1]!} ${date.day}`;
      const label = back === 0 ? "Today" : back === 1 ? "Yesterday" : dated;
      return { label, at: date.toString() };
    });
  }

  export const MIDNIGHT = "00:00:00";

  export function toDateField(instant: Temporal.Instant, timezone: string): string {
    return Timezone.toWallClock(instant, timezone).toPlainDate().toString();
  }

  export function toTimeField(instant: Temporal.Instant, timezone: string): string {
    return Timezone.toWallClock(instant, timezone).toPlainTime().toString({ smallestUnit: "second" });
  }

  export function parse(date: string, time: string, timezone: string): Temporal.Instant | null {
    if (!date) {
      return null;
    }
    return Timezone.fromWallClock(`${date}T${time.trim() || MIDNIGHT}`, timezone);
  }
}
