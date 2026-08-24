import { Prettify } from "@/helpers/Prettify";
import { ContainerRM } from "@/models/ContainerRM";
import clsx from "clsx";
import { Link } from "react-router";
import { Route } from "../Route";
import { Paper } from "./basics/Paper";

type Props = {
  container: ContainerRM;
};
export function ContainerCard({ container: { did, dname: name, dgroup: group, running, logsPerSecond, throttling, lastSeen } }: Props) {
  return (
    <Link to={Route.containerLogs(did)}>
      <Paper className="flex h-full flex-col gap-1 px-5 py-4 transition-colors hover:border-c-accent">
        <div className="flex items-baseline gap-2">
          <span className={clsx("truncate", running ? "text-c-accent" : "text-c-rule")}>{name}</span>
          {!running && <span className="shrink-0 text-xs tracking-wide text-c-rule">STOPPED</span>}
        </div>
        {group && <span className="truncate text-xs text-c-rule">{group}</span>}
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-sm">{logsPerSecond}</span>
          <span className="text-xs text-c-rule">logs/s</span>
          {throttling && <span className="text-xs text-c-error">THROTTLED</span>}
        </div>
        <span className="text-xs text-c-rule">{Prettify.describeLastSeenLogs(lastSeen)}</span>
      </Paper>
    </Link>
  );
}
