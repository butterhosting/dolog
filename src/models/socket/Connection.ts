import { PredicateFactory } from "@/repositories/PredicateFactory";
import { Temporal } from "@js-temporal/polyfill";
import { Socket } from "./Socket";

export type Connection = {
  socket: Socket;
  lastHeardBack: Temporal.Instant;
  watchedContainerId?: string;
  filterPredicate?: (candidate: PredicateFactory.Candidate) => boolean;
  filterDropThrottleEvents: boolean;
};
