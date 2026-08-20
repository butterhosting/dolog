import { Prettify } from "@/helpers/Prettify";
import { ContainerRM } from "@/models/ContainerRM";
import clsx from "clsx";
import { Link } from "react-router";
import { Route } from "../Route";
import { Paper } from "./basics/Paper";

type Props = {
  container: ContainerRM;
};
export function ContainerCard({ container: { id, name, group, running, logsPerSecond, throttling, lastSeen } }: Props) {
  return (
    <Link to={Route.containerLogs(id)}>
      <Paper className="px-5 py-4 h-full flex flex-col gap-1 hover:shadow-xl transition-shadow">
        <div className="flex items-baseline gap-2">
          <span className={clsx("font-bold truncate", running ? "text-c-accent" : "text-c-dark-half")}>{name}</span>
          {!running && <span className="text-xs tracking-wide text-c-dark-half shrink-0">STOPPED</span>}
        </div>
        {group && <span className="text-xs text-c-dark-half truncate">{group}</span>}
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-mono text-sm">{logsPerSecond}</span>
          <span className="text-xs text-c-dark-half">logs/s</span>
          {throttling && <span className="text-xs font-bold text-c-error">THROTTLED</span>}
        </div>
        <span className="text-xs text-c-dark-half">{Prettify.describeLastSeenLogs(lastSeen)}</span>
      </Paper>
    </Link>
  );
}
