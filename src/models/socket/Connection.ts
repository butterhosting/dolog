import { Temporal } from "@js-temporal/polyfill";
import { Socket } from "./Socket";

export type Connection = {
  socket: Socket;
  lastHeardBack: Temporal.Instant;
  watchedContainerId: string | null;
  logsPredicate: ((line: string) => boolean) | null;
};
