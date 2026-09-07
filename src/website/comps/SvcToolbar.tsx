import { LiveStats } from "@/models/LiveStats";
import clsx from "clsx";
import { ReactNode } from "react";
import { useFilter } from "../hooks/useFilter";
import { useTextSize } from "../hooks/useTextSize";
import { Button } from "./basics/Button";
import { Toggle } from "./basics/Toggle";
import { PatternField } from "./PatternField";
import { Prettify } from "@/helpers/Prettify";

type Props = {
  filter: useFilter.Result;
  textSize: useTextSize.Result;
  liveStats?: LiveStats;
  onApply: () => void;
  onNavigate: () => void;
  onSearch: () => void;
};

export function SvcToolbar({ filter, textSize, liveStats, onApply, onNavigate, onSearch }: Props) {
  const { form, formState } = filter;
  return (
    <div className="flex h-14 items-center border-b border-c-rule bg-c-shell">
      <Internal.Cell className="pl-5 pr-4">
        <Button onClick={onNavigate} title="jump to a moment in time">
          Navigate {Internal.MODIFIER}I
        </Button>
      </Internal.Cell>

      <Internal.Cell className="px-4">
        <Button onClick={onSearch} title="find a line among the ones on screen">
          {" "}
          {/* TODO: fix all `button` titles */}
          Search {Internal.MODIFIER}K
        </Button>
      </Internal.Cell>

      <Internal.Cell className="gap-2 px-4">
        {useTextSize.SIZES.map((size) => (
          <Toggle key={size} active={textSize.size === size} onClick={() => textSize.setSize(size)} title={`${size.toUpperCase()} text`}>
            {size.toUpperCase()}
          </Toggle>
        ))}
      </Internal.Cell>

      {/* cpu/mem stats */}
      <Internal.Cell className={clsx(liveStats ? "lg:hidden" : "hidden", "flex-1 px-4")}>
        {liveStats && (
          <div className="flex-1 flex flex-col">
            <div className="flex justify-between">
              <div>CPU {Prettify.percentage(liveStats.cpuUsage, liveStats.cpuTotalCores)}</div>
              <div className="text-c-rule">
                {Prettify.cores(liveStats.cpuUsage)} / {Prettify.cores(liveStats.cpuTotalCores)} cores
              </div>
            </div>
            <div className="h-1 bg-c-chip">
              <div
                className="w-full h-full bg-c-accent"
                style={{ width: Prettify.percentage(liveStats.cpuUsage, liveStats.cpuTotalCores) }}
              />
            </div>
          </div>
        )}
      </Internal.Cell>
      <Internal.Cell className={clsx(liveStats ? "lg:hidden" : "hidden", "flex-1 px-4")}>
        {liveStats && (
          <div className="flex-1 flex flex-col">
            <div className="flex justify-between">
              <div>MEM {Prettify.percentage(liveStats.memoryUsage, liveStats.memoryTotalBytes)}</div>
              <div className="text-c-rule">
                {Prettify.bytes(liveStats.memoryUsage)} / {Prettify.bytes(liveStats.memoryTotalBytes)}
              </div>
            </div>
            <div className="h-1 bg-c-chip">
              <div
                className="w-full h-full bg-c-accent"
                style={{ width: Prettify.percentage(liveStats.memoryUsage, liveStats.memoryTotalBytes) }}
              />
            </div>
          </div>
        )}
      </Internal.Cell>
      {/* no stats */}
      <Internal.Cell className={clsx(liveStats ? "hidden lg:flex" : "flex", "flex-1")} />

      <Internal.Cell last className="gap-2.5 px-4">
        <PatternField
          className="w-64"
          type={form.patternType}
          onToggleType={form.togglePatternType}
          value={form.pattern}
          onValueChange={form.setPattern}
          onKeyDown={(event) => event.key === "Enter" && formState.dirty && onApply()}
          placeholder="Type to filter"
        />
        <Button onClick={onApply} disabled={!formState.dirty}>
          Apply
        </Button>
      </Internal.Cell>
    </div>
  );
}

namespace Internal {
  // The shortcut the page actually binds accepts either, so the hint names the one this keyboard has
  export const MODIFIER = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+";

  type CellProps = {
    className?: string;
    last?: boolean;
    children?: ReactNode;
  };
  /** The toolbar is ruled into compartments, and only the last one has nothing to its right. */
  export function Cell({ className, last, children }: CellProps) {
    return <div className={clsx("flex h-full items-center", !last && "border-r border-c-rule", className)}>{children}</div>;
  }
}
