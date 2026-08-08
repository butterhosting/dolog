import { Temporal } from "@js-temporal/polyfill";
import { Socket } from "./Socket";

export type Connection = {
  socket: Socket;
  lastHeardBack: Temporal.Instant;
  watchedContainerId: string | null;
  logsFilter: ((line: string) => boolean) | null;
};
