import { ContainerEvent } from "@/models/ContainerEvent";
import { useEffect, useState } from "react";
import { SvcClient } from "../clients/SvcClient";
import { useRegistry } from "./basics/useRegistry";

/**
 * Gets the container name, either from the API, or by deriving it from the events
 */
export function useSvcName(id: string, events: ContainerEvent[]): string {
  const svcClient = useRegistry(SvcClient);
  const [name, setName] = useState(id.slice(0, 12));

  // approach 1
  useEffect(() => {
    void svcClient.list().then((svcs) => {
      const svc = svcs.find((svc) => svc.id === id);
      if (svc) {
        setName(svc.dgroup ? `${svc.dgroup} :: ${svc.dname}` : svc.dname);
      }
    });
  }, [svcClient, id]);

  // approach 2
  useEffect(() => {
    const container = events.at(0)?.container;
    if (container) {
      setName(container.dgroup ? `${container.dgroup} :: ${container.dname}` : container.dname);
    }
  }, [events]);

  return name;
}
