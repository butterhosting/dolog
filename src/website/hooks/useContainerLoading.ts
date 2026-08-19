import { ContainerEvent } from "@/models/ContainerEvent";
import { Dispatch, SetStateAction } from "react";

export function useContainerLoading() {}

type Result = {
  events: ContainerEvent[];
  setEvents: Dispatch<SetStateAction<ContainerEvent[]>>; // also used by the livestream
  loading: boolean;
  hasNewer: boolean;
  hasOlder: boolean;
  landedAt: string;
};
