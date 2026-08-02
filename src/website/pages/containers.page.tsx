import { useEffect } from "react";
import { useYesQuery } from "react-yesquery";
import { ContainerClient } from "../clients/ContainerClient";
import { Frame } from "../comps/Frame";
import { Paper } from "../comps/Paper";
import { Spinner } from "../comps/Spinner";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useRegistry } from "../hooks/useRegistry";

const REFRESH_INTERVAL_MS = 1_000;

export function containersPage() {
  useDocumentTitle("Containers | Dolog");
  const containerClient = useRegistry(ContainerClient);
  const { data: throughput, reload } = useYesQuery({
    queryFn: () => containerClient.queryThroughput(),
  });

  /**
   * The throttler recomputes its readings once per second, so polling at the same rate keeps the
   * dashboard live without a websocket.
   */
  useEffect(() => {
    const timer = setInterval(() => void reload(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const rows = [...(throughput ?? [])].sort((a, b) => a.container.name.localeCompare(b.container.name));

  return (
    <Frame>
      <Paper>
        {rows.map((row) => (
          <div key={row.container.id} data-testid="container-row" className="flex items-center gap-4 px-6 py-4 border-b border-black/5 last:border-b-0">
            <div className="flex-1 flex flex-col gap-0.5">
              <span className="font-bold">{row.container.name}</span>
              {row.container.group && <span className="text-sm text-c-dark-half">{row.container.group}</span>}
            </div>
            <Internal.Metric label="logs/s" value={`${row.logsPerSecond}`} />
            <Internal.Metric label="throughput" value={Internal.formatBytes(row.bytesPerSecond)} />
            {row.throttling && (
              <span className="text-xs font-bold tracking-wide text-c-error" title="logs are being dropped">
                THROTTLED
              </span>
            )}
          </div>
        ))}
        {!throughput && (
          <div className="px-6 py-12 flex justify-center">
            <Spinner />
          </div>
        )}
        {throughput?.length === 0 && (
          <div className="px-6 py-12 text-center">
            <span className="text-sm font-bold text-c-dark-half tracking-wide">NO CONTAINER ACTIVITY</span>
          </div>
        )}
      </Paper>
    </Frame>
  );
}

namespace Internal {
  type MetricProps = {
    label: string;
    value: string;
    muted?: boolean;
  };

  export function Metric({ label, value, muted = false }: MetricProps) {
    return (
      <div className="flex flex-col items-end w-24">
        <span className={muted ? "font-mono text-c-dark-half" : "font-mono"}>{value}</span>
        <span className="text-xs text-c-dark-half tracking-wide">{label}</span>
      </div>
    );
  }

  export function formatBytes(bytesPerSecond: number): string {
    if (bytesPerSecond < 1024) {
      return `${bytesPerSecond} B/s`;
    }
    if (bytesPerSecond < 1024 * 1024) {
      return `${(bytesPerSecond / 1024).toFixed(1)} kB/s`;
    }
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
}
