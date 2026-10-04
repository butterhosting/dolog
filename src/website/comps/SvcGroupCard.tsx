import { Svc } from "@/models/Svc";
import clsx from "clsx";
import { Link } from "react-router";
import { Route } from "../Route";
import { Bar } from "./basics/Bar";
import { Paper } from "./basics/Paper";

// the header's labels sit over the columns of the lines below, so both use the same grid
const COLUMNS = "grid grid-cols-[0.375rem_minmax(0,1fr)_3rem_3rem_6ch] items-center gap-x-3";

type Props = {
  name?: string;
  svcs: Svc[];
};
export function SvcGroupCard({ name, svcs }: Props) {
  return (
    <Paper data-testid="svc-group" className="mb-6 break-inside-avoid overflow-hidden">
      <div className={clsx(COLUMNS, "items-baseline bg-c-chip/50 py-2.5 pr-4 pl-[calc(1rem+2px)]")}>
        <h2 className={clsx("col-span-2 truncate", name ? "font-semibold" : "italic text-c-rule")}>{name ?? "(ungrouped)"}</h2>
        <span className="text-xs tracking-wider text-c-rule">CPU</span>
        <span className="text-xs tracking-wider text-c-rule">MEM</span>
        <span className="text-right text-xs tracking-wider text-c-rule">LOGS</span>
      </div>
      {svcs.map((svc) => (
        <Internal.Line key={svc.id} svc={svc} />
      ))}
    </Paper>
  );
}

namespace Internal {
  type LineProps = {
    svc: Svc;
  };
  export function Line({ svc: { id, dname, mostRecentContainer: { liveStats } } }: LineProps) {
    return (
      <Link
        to={Route.svcsLogs(id)}
        data-testid="svc-line"
        title={liveStats ? dname : `${dname} (stopped)`}
        className={clsx(
          COLUMNS,
          "border-t border-l-2 border-t-white/10 border-l-transparent py-1.5 pr-4 pl-4 transition-colors hover:border-l-c-accent hover:bg-white/5",
          !liveStats && "opacity-50",
        )}
      >
        <span className={clsx("size-1.5 rounded-full", liveStats ? "bg-c-severity-info" : "bg-c-rule")} />
        <span className="truncate">{dname}</span>
        <Bar part={liveStats?.cpuUsage ?? 0} whole={liveStats?.cpuTotal ?? 0} />
        <Bar part={liveStats?.memoryUsage ?? 0} whole={liveStats?.memoryTotal ?? 0} />
        {!liveStats && <span className="text-right text-xs italic text-c-rule">N/A</span>}
        {liveStats && (
          <span
            title={liveStats.throttling ? "throttling: lines are being dropped" : undefined}
            className={clsx("text-right text-xs whitespace-nowrap italic", liveStats.throttling ? "text-c-error" : "text-c-rule")}
          >
            {liveStats.logsPerSecond}/s
            {liveStats.throttling && <span className="sr-only"> throttling</span>}
          </span>
        )}
      </Link>
    );
  }
}
