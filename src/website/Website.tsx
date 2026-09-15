import { useEffect, useState } from "react";
import { createBrowserRouter, replace, RouterProvider } from "react-router";
import { ClientRegistry } from "./ClientRegistry";
import { DialogClient } from "./clients/DialogClient";
import { SocketClient } from "./clients/SocketClient";
import { DialogManager } from "./comps/basics/DialogManager";
import { configurationPage } from "./pages/configuration.page";
import { svcLogsPage } from "./pages/svc.logs.page";
import { svcsPage } from "./pages/svcs.page";
import { Route } from "./Route";

const router = createBrowserRouter([
  {
    path: Route.svcs(),
    Component: svcsPage,
  },
  {
    path: Route.svcsLogs(),
    Component: svcLogsPage,
  },
  {
    path: Route.configuration(),
    Component: configurationPage,
  },
  {
    path: "*",
    loader: () => replace(Route.svcs()),
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
        <DialogManager ref={(manager) => clientRegistry.get(DialogClient).initialize(manager)} />
      </ClientRegistry.Context.Provider>
    );
  }
  return null;
}
