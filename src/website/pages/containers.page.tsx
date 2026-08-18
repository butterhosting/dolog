import { ServerMessage } from "@/models/socket/ServerMessage";
import { Temporal } from "@js-temporal/polyfill";
import { useEffect } from "react";
import { useYesQuery } from "react-yesquery";
import { ContainerClient } from "../clients/ContainerClient";
import { SocketClient } from "../clients/SocketClient";
import { ContainerCard } from "../comps/ContainerCard";
import { Frame } from "../comps/Frame";
import { Paper } from "../comps/Paper";
import { Spinner } from "../comps/Spinner";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useRegistry } from "../hooks/useRegistry";

export function containersPage() {
  useDocumentTitle("Containers | Dolog");
  const containerClient = useRegistry(ContainerClient);
  const socketClient = useRegistry(SocketClient);
  const { data, setData, reload } = useYesQuery({
    queryFn: () => containerClient.list(),
  });

  useEffect(() => {
    const POLL_INTERVAL = Temporal.Duration.from({ seconds: 30 });
    const reloadId = setInterval(() => void reload(), POLL_INTERVAL.total("milliseconds"));

    socketClient.undeclareStreamInterest();
    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.containers,
      callback: ({ containers }) => setData(containers),
    });

    return () => {
      clearInterval(reloadId);
      socketClient.unsubscribe(subscription);
    };
  }, [reload, socketClient]);

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
          <span className="text-sm font-bold tracking-wide text-c-dark-half">NO CONTAINERS</span>
        </Paper>
      )}
      <div className="grid grid-cols-3 lg:grid-cols-2 sm:grid-cols-1 gap-4">
        {data.map((container) => (
          <ContainerCard key={container.id} container={container} />
        ))}
      </div>
    </Frame>
  );
}
