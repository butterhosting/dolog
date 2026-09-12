import { Prettify } from "@/helpers/Prettify";
import { LiveStats } from "@/models/LiveStats";
import clsx from "clsx";
import { useFilter } from "../hooks/useFilter";
import { useTextSize } from "../hooks/useTextSize";
import { Button } from "./basics/Button";
import { Cell } from "./basics/Cell";
import { Toggle } from "./basics/Toggle";
import { Meter } from "./Meter";
import { PatternField } from "./PatternField";

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
      <Cell className="pl-5 pr-4">
        <Button onClick={onNavigate} title="jump to a moment in time">
          Navigate {Internal.MODIFIER}I
        </Button>
      </Cell>

      <Cell className="px-4">
        <Button onClick={onSearch} title="find a line among the ones on screen">
          {" "}
          {/* TODO: fix all `button` titles */}
          Search {Internal.MODIFIER}K
        </Button>
      </Cell>

      <Cell className="gap-2 px-4">
        {useTextSize.SIZES.map((size) => (
          <Toggle key={size} active={textSize.size === size} onClick={() => textSize.setSize(size)} title={`${size.toUpperCase()} text`}>
            {size.toUpperCase()}
          </Toggle>
        ))}
      </Cell>

      {/* cpu/mem stats */}
      <Cell className={clsx(liveStats ? "lg:hidden" : "hidden", "flex-1 px-4")}>
        {liveStats && <Meter label="CPU" part={liveStats.cpuUsage} whole={liveStats.cpuTotal} format={Prettify.cores} unit="cores" />}
      </Cell>
      <Cell className={clsx(liveStats ? "lg:hidden" : "hidden", "flex-1 px-4")}>
        {liveStats && <Meter label="MEM" part={liveStats.memoryUsage} whole={liveStats.memoryTotal} format={Prettify.bytes} />}
      </Cell>
      {/* no stats */}
      <Cell className={clsx(liveStats ? "hidden lg:flex" : "flex", "flex-1")} />

      <Cell last className="gap-2.5 px-4">
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
      </Cell>
    </div>
  );
}

namespace Internal {
  // The shortcut the page actually binds accepts either, so the hint names the one this keyboard has
  export const MODIFIER = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+";
}
