import { ContainerEvent } from "@/models/ContainerEvent";
import { useEffect, useState } from "react";
import { ContainerClient } from "../clients/ContainerClient";
import { useRegistry } from "./useRegistry";

/**
 * Gets the container name, either from the API, or by deriving it from the events
 */
export function useContainerName(id: string, events: ContainerEvent[]): string {
  const containerClient = useRegistry(ContainerClient);
  const [name, setName] = useState(id.slice(0, 12));

  // approach 1
  useEffect(() => {
    void containerClient.list().then((containers) => {
      const mine = containers.find((container) => container.id === id);
      if (mine) {
        setName(mine.name);
      }
    });
  }, [containerClient, id]);

  // approach 2
  useEffect(() => {
    const found = events.at(-1)?.container.name ?? events.at(0)?.container.name;
    if (found) {
      setName(found);
    }
  }, [events]);

  return name;
}
