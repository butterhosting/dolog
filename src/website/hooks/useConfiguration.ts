import { Configuration } from "@/models/Configuration";
import { ServerMessage } from "@/models/socket/ServerMessage";
import { useEffect } from "react";
import { useYesQuery } from "react-yesquery";
import { ConfigurationClient } from "../clients/ConfigurationClient";
import { SocketClient } from "../clients/SocketClient";
import { useRegistry } from "./basics/useRegistry";

export function useConfiguration(): Configuration | undefined {
  const configurationClient = useRegistry(ConfigurationClient);
  const socketClient = useRegistry(SocketClient);

  const { data, setData } = useYesQuery({
    queryFn: () => configurationClient.get(),
  });
  useEffect(() => {
    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.configuration,
      callback: ({ configuration }) => setData(configuration),
    });
    return () => {
      socketClient.unsubscribe(subscription);
    };
  }, []);

  return data;
}
