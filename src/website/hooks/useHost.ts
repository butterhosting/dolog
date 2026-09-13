import { Host } from "@/models/Host";
import { ServerMessage } from "@/models/socket/ServerMessage";
import { useEffect } from "react";
import { useYesQuery } from "react-yesquery";
import { HostClient } from "../clients/HostClient";
import { SocketClient } from "../clients/SocketClient";
import { useRegistry } from "./basics/useRegistry";

export function useHost(): Host | undefined {
  const hostClient = useRegistry(HostClient);
  const socketClient = useRegistry(SocketClient);

  const { data, setData } = useYesQuery({
    queryFn: () => hostClient.get(),
  });
  useEffect(() => {
    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.host,
      callback: ({ host }) => setData(host),
    });
    return () => {
      socketClient.unsubscribe(subscription);
    };
  }, []);

  return data;
}
