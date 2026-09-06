import clsx from "clsx";
import { Link } from "react-router";
import { Route } from "../Route";
import { Paper } from "./basics/Paper";
import { Svc } from "@/models/Svc";
import { Prettify } from "@/helpers/Prettify";

type Props = {
  svc: Svc;
};
export function SvcCard({ svc: { id, dname, dgroup, liveStats } }: Props) {
  return (
    <Link to={Route.svcsLogs(id)}>
      <Paper className="flex h-full flex-col gap-1 px-5 py-4 transition-colors hover:border-c-accent">
        <div className="flex items-baseline gap-2">
          <span className={clsx("truncate", liveStats ? "text-c-accent" : "text-c-rule")}>{dname}</span>
          {!liveStats && <span className="shrink-0 text-xs tracking-wide text-c-rule">STOPPED</span>}
        </div>
        {dgroup && <span className="truncate text-xs text-c-rule">{dgroup}</span>}
        {liveStats && (
          <div className="mt-2 flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm">{liveStats.logsPerSecond}</span>
              <span className="text-xs text-c-rule">{liveStats.logsPerSecond === 1 ? "log/s" : "logs/s"}</span>
              {liveStats.throttling && <span className="text-xs text-c-error">THROTTLED</span>}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm">{Prettify.cores(liveStats.cpuUsage)}</span>
              <span className="text-xs text-c-rule">of {Prettify.cores(liveStats.cpuTotalCores)} cpu</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm">{Prettify.bytes(liveStats.memoryUsage)}</span>
              <span className="text-xs text-c-rule">of {Prettify.bytes(liveStats.memoryTotalBytes)} memory</span>
            </div>
          </div>
        )}
      </Paper>
    </Link>
  );
}
