import { Svc } from "@/models/Svc";
import clsx from "clsx";
import { Link } from "react-router";
import { Route } from "../Route";
import { Bar } from "./basics/Bar";
import { Paper } from "./basics/Paper";

type Props = {
  svc: Svc;
};
export function SvcCard({ svc: { id, dname, liveStats } }: Props) {
  return (
    <Link to={Route.svcsLogs(id)} className="w-64">
      <Paper className={clsx("flex h-full flex-col gap-3 px-4 py-3 transition-colors hover:border-c-accent", !liveStats && "opacity-50")}>
        <span className="truncate">{dname}</span>
        {liveStats ? (
          <div className="flex flex-col gap-1.5">
            <Internal.Row label="CPU" part={liveStats.cpuUsage} whole={liveStats.cpuTotal} />
            <Internal.Row label="MEM" part={liveStats.memoryUsage} whole={liveStats.memoryTotal} />
            <span className={clsx("self-end whitespace-nowrap text-xs italic", liveStats.throttling ? "text-c-error" : "text-c-rule")}>
              {liveStats.throttling ? "throttling" : `${liveStats.logsPerSecond} ${liveStats.logsPerSecond === 1 ? "log" : "logs"}/second`}
            </span>
          </div>
        ) : (
          <span className="text-xs italic text-c-rule">stopped</span>
        )}
      </Paper>
    </Link>
  );
}

namespace Internal {
  type RowProps = {
    label: string;
    part: number;
    whole: number;
  };
  export function Row({ label, part, whole }: RowProps) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-8 text-xs text-c-rule">{label}</span>
        <Bar className="flex-1" part={part} whole={whole} />
      </div>
    );
  }
}
