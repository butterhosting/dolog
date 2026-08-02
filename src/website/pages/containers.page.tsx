import { ContainerOverview } from "@/models/ContainerOverview";
import { ServerMessage } from "@/socket/ServerMessage";
import { Temporal } from "@js-temporal/polyfill";
import clsx from "clsx";
import { useEffect } from "react";
import { Link } from "react-router";
import { useYesQuery } from "react-yesquery";
import { ContainerClient } from "../clients/ContainerClient";
import { SocketClient } from "../clients/SocketClient";
import { Frame } from "../comps/Frame";
import { Paper } from "../comps/Paper";
import { Spinner } from "../comps/Spinner";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useRegistry } from "../hooks/useRegistry";
import { Route } from "../Route";

const POLL_INTERVAL_MS = 30_000;

export function containersPage() {
  useDocumentTitle("Containers | Dolog");
  const containerClient = useRegistry(ContainerClient);
  const socketClient = useRegistry(SocketClient);
  const { data: overview, reload } = useYesQuery({
    queryFn: () => containerClient.overview(),
  });

  /**
   * The poll carries the ordering and the rates; the socket only says "the set changed", which is
   * what makes a container appear the moment it starts rather than up to 30 seconds later.
   */
  useEffect(() => {
    socketClient.watch(null);
    const timer = setInterval(() => void reload(), POLL_INTERVAL_MS);
    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.containers,
      callback: () => void reload(),
    });
    return () => {
      clearInterval(timer);
      socketClient.unsubscribe(subscription);
    };
  }, [reload, socketClient]);

  if (!overview) {
    return (
      <Frame>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      {overview.length === 0 && (
        <Paper className="px-6 py-12 text-center">
          <span className="text-sm font-bold tracking-wide text-c-dark-half">NO CONTAINERS</span>
        </Paper>
      )}
      <div className="grid grid-cols-3 lg:grid-cols-2 sm:grid-cols-1 gap-4">
        {overview.map((entry) => (
          <Internal.Card key={entry.container.id} entry={entry} />
        ))}
      </div>
    </Frame>
  );
}

namespace Internal {
  export function Card({ entry }: { entry: ContainerOverview }) {
    const { container, running, logsPerSecond, throttling, lastSeen } = entry;
    return (
      <Link to={Route.containerLogs(container.id)}>
        <Paper className="px-5 py-4 h-full flex flex-col gap-1 hover:shadow-xl transition-shadow">
          <div className="flex items-baseline gap-2">
            <span className={clsx("font-bold truncate", running ? "text-c-accent" : "text-c-dark-half")}>{container.name}</span>
            {!running && <span className="text-xs tracking-wide text-c-dark-half shrink-0">STOPPED</span>}
          </div>
          {container.group && <span className="text-xs text-c-dark-half truncate">{container.group}</span>}
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-sm">{logsPerSecond}</span>
            <span className="text-xs text-c-dark-half">logs/s</span>
            {throttling && <span className="text-xs font-bold text-c-error">THROTTLED</span>}
          </div>
          <span className="text-xs text-c-dark-half">{describeLastSeen(lastSeen)}</span>
        </Paper>
      </Link>
    );
  }

  function describeLastSeen(lastSeen: Temporal.Instant | null): string {
    if (!lastSeen) {
      return "nothing logged yet";
    }
    const seconds = Math.max(0, Math.round((Date.now() - lastSeen.epochMilliseconds) / 1000));
    if (seconds < 5) {
      return "just now";
    }
    if (seconds < 60) {
      return `${seconds}s ago`;
    }
    if (seconds < 3600) {
      return `${Math.round(seconds / 60)}m ago`;
    }
    return `${Math.round(seconds / 3600)}h ago`;
  }
}
