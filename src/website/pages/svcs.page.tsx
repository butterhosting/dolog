import { ServerMessage } from "@/models/socket/ServerMessage";
import { Temporal } from "@js-temporal/polyfill";
import { useEffect } from "react";
import { useYesQuery } from "react-yesquery";
import { SvcClient } from "../clients/SvcClient";
import { SocketClient } from "../clients/SocketClient";
import { SvcCard } from "../comps/SvcCard";
import { Frame } from "../comps/basics/Frame";
import { Paper } from "../comps/basics/Paper";
import { Spinner } from "../comps/basics/Spinner";
import { useDocumentTitle } from "../hooks/basics/useDocumentTitle";
import { useRegistry } from "../hooks/basics/useRegistry";

export function svcsPage() {
  useDocumentTitle("Containers | Dolog");
  const svcClient = useRegistry(SvcClient);
  const socketClient = useRegistry(SocketClient);
  const { data, setData, reload } = useYesQuery({
    queryFn: () => svcClient.list(),
  });

  useEffect(() => {
    const POLL_INTERVAL = Temporal.Duration.from({ seconds: 30 });
    const reloadId = setInterval(() => void reload(), POLL_INTERVAL.total("milliseconds"));

    socketClient.undeclareStreamInterest();
    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.svcs,
      callback: ({ svcs }) => setData(svcs),
    });

    return () => {
      clearInterval(reloadId);
      socketClient.unsubscribe(subscription);
    };
  }, []);

  if (!data) {
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
      {data.length === 0 && (
        <Paper className="px-6 py-12 text-center">
          <span className="text-sm tracking-wide text-c-rule">NO CONTAINERS</span>
        </Paper>
      )}
      <div className="grid grid-cols-3 lg:grid-cols-2 sm:grid-cols-1 gap-4">
        {data.map((svc) => (
          <SvcCard key={svc.id} svc={svc} />
        ))}
      </div>
    </Frame>
  );
}
