import { ContainerEvent } from "@/models/ContainerEvent";
import { useEffect, useState } from "react";
import { ContainerClient } from "../clients/ContainerClient";
import { useRegistry } from "./basics/useRegistry";

/**
 * Gets the container name, either from the API, or by deriving it from the events
 */
export function useContainerName(id: string, events: ContainerEvent[]): string {
  const containerClient = useRegistry(ContainerClient);
  const [name, setName] = useState(id.slice(0, 12));

  // approach 1
  useEffect(() => {
    void containerClient.list().then((containers) => {
      const mine = containers.find((container) => container.did === id);
      if (mine) {
        setName(mine.dname);
      }
    });
  }, [containerClient, id]);

  // approach 2
  useEffect(() => {
    const found = events.at(-1)?.container.dname ?? events.at(0)?.container.dname;
    if (found) {
      setName(found);
    }
  }, [events]);

  return name;
}
