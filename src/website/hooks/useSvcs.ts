import { ServerMessage } from "@/models/socket/ServerMessage";
import { Svc } from "@/models/Svc";
import { useEffect } from "react";
import { useYesQuery } from "react-yesquery";
import { SocketClient } from "../clients/SocketClient";
import { SvcClient } from "../clients/SvcClient";
import { useRegistry } from "./basics/useRegistry";

export function useSvcs(): Svc[] | undefined;
export function useSvcs(opts: { id: string }): Svc | undefined;
export function useSvcs(opts?: { id: string }): Svc[] | Svc | undefined {
  const svcClient = useRegistry(SvcClient);
  const socketClient = useRegistry(SocketClient);

  const { data, setData } = useYesQuery({
    queryFn: () => svcClient.list(),
  });
  useEffect(() => {
    const subscription = socketClient.subscribe({
      type: ServerMessage.Type.svcs,
      callback: ({ svcs }) => setData(svcs),
    });
    return () => {
      socketClient.unsubscribe(subscription);
    };
  }, []);

  if (!data) {
    return undefined;
  }
  if (opts) {
    return data.find((s) => Svc.matches(opts.id, s));
  }
  return data;
}
