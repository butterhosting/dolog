import clsx from "clsx";
import { Link } from "react-router";
import { Route } from "../Route";
import { Paper } from "./basics/Paper";
import { Svc } from "@/models/Svc";

type Props = {
  svc: Svc;
};
export function SvcCard({ svc: { id, dname, dgroup, online, logsPerSecond, throttling } }: Props) {
  return (
    <Link to={Route.svcsLogs(id)}>
      <Paper className="flex h-full flex-col gap-1 px-5 py-4 transition-colors hover:border-c-accent">
        <div className="flex items-baseline gap-2">
          <span className={clsx("truncate", online ? "text-c-accent" : "text-c-rule")}>{dname}</span>
          {!online && <span className="shrink-0 text-xs tracking-wide text-c-rule">STOPPED</span>}
        </div>
        {dgroup && <span className="truncate text-xs text-c-rule">{dgroup}</span>}
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-sm">{logsPerSecond}</span>
          <span className="text-xs text-c-rule">logs/s</span>
          {throttling && <span className="text-xs text-c-error">THROTTLED</span>}
        </div>
        <span className="text-xs text-c-rule">[Last seen property removed]</span>
      </Paper>
    </Link>
  );
}
