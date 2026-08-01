import { ServerMessage } from "@/socket/ServerMessage";
import { useEffect, useState } from "react";
import { createBrowserRouter, replace, RouterProvider } from "react-router";
import { ClientRegistry } from "./ClientRegistry";
import { SocketClient } from "./clients/SocketClient";
import { containersPage } from "./pages/containers.page";
import { Route } from "./Route";

const router = createBrowserRouter([
  {
    path: Route.containers(),
    Component: containersPage,
  },
  {
    path: "*",
    loader: () => replace(Route.containers()),
  },
]);

export function Website() {
  const [clientRegistry, setClientRegistry] = useState<ClientRegistry>();
  useEffect(() => {
    ClientRegistry.bootstrap().then((registry) => {
      setClientRegistry(registry);
      const socketClient = registry.get(SocketClient);
      socketClient.connect();
      socketClient.subscribe({
        type: ServerMessage.Type.heartbeat,
        callback: ({ timestamp }) => console.log(`💓 heartbeat @ ${timestamp}`),
      });
    });
  }, []);
  if (clientRegistry) {
    return (
      <ClientRegistry.Context.Provider value={clientRegistry}>
        <RouterProvider router={router} />
      </ClientRegistry.Context.Provider>
    );
  }
  return null;
}
