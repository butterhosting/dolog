import { useEffect, useState } from "react";
import { createBrowserRouter, replace, RouterProvider } from "react-router";
import { ClientRegistry } from "./ClientRegistry";
import { SocketClient } from "./clients/SocketClient";
import { containerLogsPage } from "./pages/containerLogs.page";
import { containersPage } from "./pages/containers.page";
import { Route } from "./Route";

const router = createBrowserRouter([
  {
    path: Route.containers(),
    Component: containersPage,
  },
  {
    path: Route.containerLogs(),
    Component: containerLogsPage,
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
      registry.get(SocketClient).connect();
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
