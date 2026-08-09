import { ContainerEvent } from "@/models/ContainerEvent";
import { useEffect, useState } from "react";
import { ContainerClient } from "../clients/ContainerClient";
import { useRegistry } from "./useRegistry";

/**
 * What to call the container, taken from the overview rather than from the events -- which carry it
 * too, but a filter matching nothing leaves none to read it from, and the title would fall back to a
 * chopped id for a container that is perfectly well known.
 */
export function useContainerName(id: string, events: ContainerEvent[]): string {
  const containerClient = useRegistry(ContainerClient);
  const [name, setName] = useState(id.slice(0, 12));

  useEffect(() => {
    // asked for outright rather than waited for: the overview is only broadcast when it *changes*,
    // so a quiet container would never announce itself to a page that had just opened
    void containerClient.list().then((containers) => {
      const mine = containers.find((container) => container.id === id);
      if (mine) {
        setName(mine.name);
      }
    });
  }, [containerClient, id]);

  useEffect(() => {
    const found = events.at(-1)?.container.name ?? events.at(0)?.container.name;
    if (found) {
      setName(found);
    }
  }, [events]);

  return name;
}
