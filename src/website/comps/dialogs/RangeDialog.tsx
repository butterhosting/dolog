import { RangeDisplay } from "@/helpers/RangeDisplay";
import { Timezone } from "@/helpers/Timezone";
import { useRegistry } from "@/website/hooks/basics/useRegistry";
import { Range } from "@/website/hooks/objects/Range";
import { Temporal } from "@js-temporal/polyfill";
import clsx from "clsx";
import { useState } from "react";
import { Button } from "../basics/Button";
import { Dialog } from "../basics/Dialog";

type Props = {
  current: Range;
  close: () => void;
  done: (value: Range) => void;
};

export function RangeDialog({ current, close, done }: Props) {
  const { DOLOG_TIMEZONE } = useRegistry("env");
  const [custom, setCustom] = useState(current.type === "custom");
  const [since, setSince] = useState(current.type === "custom" ? Internal.toField(current.since, DOLOG_TIMEZONE) : "");
  const [until, setUntil] = useState(current.type === "custom" ? Internal.toField(current.until, DOLOG_TIMEZONE) : "");

  const parsed = { since: Timezone.fromWallClock(since, DOLOG_TIMEZONE), until: Timezone.fromWallClock(until, DOLOG_TIMEZONE) };
  // an empty end is open-ended, which is meaningful; a *malformed* one is not
  const broken = (since.length > 0 && !parsed.since) || (until.length > 0 && !parsed.until);
  const backwards = parsed.since && parsed.until && Temporal.Instant.compare(parsed.since, parsed.until) >= 0;

  return (
    <Dialog isOpen issueCloseRequestWhenClickingBackdrop issueCloseRequestWhenPressingEscape onCloseRequest={close} className="p-6">
      {!custom ? (
        <div className="flex flex-col gap-5">
          {Object.values(RangeDisplay.Group).map((group) => (
            <div key={group} className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-c-rule">{group}</span>
              <div className="flex flex-wrap gap-2">
                {RangeDisplay.presetsIn(group).map((preset) => (
                  <Internal.Pill
                    key={preset}
                    label={RangeDisplay.presetLabel(preset)}
                    active={current.type === "preset" && current.preset === preset}
                    onClick={() => done(Range.forPreset(preset))}
                  />
                ))}
                {group === RangeDisplay.Group.exact && <Internal.Pill label="Custom…" active={false} onClick={() => setCustom(true)} />}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!broken && !backwards) {
              done(Range.forCustom({ since: parsed.since ?? undefined, until: parsed.until ?? undefined }));
            }
          }}
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-bold">Custom range</h2>
            <p className="text-sm text-c-rule">In {DOLOG_TIMEZONE}. Leave either side empty for an open end.</p>
          </div>
          <div className="flex gap-3">
            {(
              [
                ["From", since, setSince],
                ["To", until, setUntil],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label} className="flex flex-1 flex-col gap-1.5">
                <span className="text-xs font-semibold text-c-rule">{label}</span>
                <input
                  type="datetime-local"
                  step="1"
                  value={value}
                  onChange={(event) => set(event.target.value)}
                  className="rounded-lg border border-c-chip-edge bg-c-chip px-3 py-2 text-sm outline-none focus:border-c-accent"
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" theme="neutral" onClick={() => setCustom(false)}>
              ← Presets
            </Button>
            <span className="flex-1 text-xs text-c-error">{backwards ? "The end comes before the start" : ""}</span>
            <Button type="button" variant="ghost" theme="neutral" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={broken || !!backwards}>
              Apply
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

namespace Internal {
  export function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          "rounded-full border px-3 py-1 text-xs cursor-pointer transition-colors",
          active
            ? "border-c-accent bg-c-accent text-c-shell"
            : "border-c-chip-edge bg-c-chip text-white hover:border-c-accent hover:text-c-accent",
        )}
      >
        {label}
      </button>
    );
  }

  export function toField(instant: Temporal.Instant | undefined, timezone: string): string {
    return instant ? Timezone.toWallClock(instant, timezone).toString({ smallestUnit: "second" }) : "";
  }
}
