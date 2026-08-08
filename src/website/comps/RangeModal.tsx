import { Temporal } from "@js-temporal/polyfill";
import clsx from "clsx";
import { useState } from "react";
import { LogRange } from "../models/LogRange";
import { Button } from "./Button";
import { Modal } from "./Modal";

type Props = {
  current: LogRange.Value;
  close: () => void;
  done: (value: LogRange.Value) => void;
};

/**
 * Picking a preset is one click and closes; picking "Custom" turns the same modal into two fields.
 * Two panels rather than two dialogs, so the presets stay one keystroke away from a half-typed date.
 */
export function RangeModal({ current, close, done }: Props) {
  const [custom, setCustom] = useState(current.kind === "custom");
  const [since, setSince] = useState(current.kind === "custom" ? Internal.toField(current.since) : "");
  const [until, setUntil] = useState(current.kind === "custom" ? Internal.toField(current.until) : "");

  const parsed = { since: Internal.parse(since), until: Internal.parse(until) };
  // an empty end is open-ended, which is meaningful; a *malformed* one is not
  const broken = (since.length > 0 && !parsed.since) || (until.length > 0 && !parsed.until);
  const backwards = parsed.since && parsed.until && Temporal.Instant.compare(parsed.since, parsed.until) >= 0;

  return (
    <Modal isOpen issueCloseRequestWhenClickingBackdrop issueCloseRequestWhenPressingEscape onCloseRequest={close} className="p-6">
      {!custom ? (
        <div className="flex flex-col gap-5">
          {(["relative", "exact"] as const).map((group) => (
            <div key={group} className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-c-dark-half">{group}</span>
              <div className="flex flex-wrap gap-2">
                {LogRange.PRESETS.filter((preset) => preset.group === group).map((preset) => (
                  <Internal.Pill
                    key={preset.id}
                    label={preset.label}
                    active={current.kind === "preset" && current.id === preset.id}
                    onClick={() => done({ kind: "preset", id: preset.id })}
                  />
                ))}
                {group === "exact" && <Internal.Pill label="Custom…" active={false} onClick={() => setCustom(true)} />}
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
              done({ kind: "custom", since: parsed.since ?? undefined, until: parsed.until ?? undefined });
            }
          }}
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-bold">Custom range</h2>
            <p className="text-sm text-c-dark-half">In UTC. Leave either side empty for an open end.</p>
          </div>
          <div className="flex gap-3">
            {(
              [
                ["From", since, setSince],
                ["To", until, setUntil],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label} className="flex flex-1 flex-col gap-1.5">
                <span className="text-xs font-semibold text-c-dark-half">{label}</span>
                <input
                  type="datetime-local"
                  step="1"
                  value={value}
                  onChange={(event) => set(event.target.value)}
                  className="rounded-lg border border-c-dark-half/40 px-3 py-2 font-mono text-sm outline-none focus:border-c-accent"
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
    </Modal>
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
            ? "border-c-accent bg-c-accent text-white"
            : "border-c-dark-half/30 text-c-dark-half hover:border-c-accent hover:text-c-accent",
        )}
      >
        {label}
      </button>
    );
  }

  /** `datetime-local` speaks a bare wall clock, so the zone is dropped rather than converted. */
  export function toField(instant: Temporal.Instant | undefined): string {
    return instant ? instant.toString({ smallestUnit: "second" }).replace("Z", "") : "";
  }

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
