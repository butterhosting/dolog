import { Temporal } from "@js-temporal/polyfill";
import { Socket } from "./Socket";
import { PredicateFactory } from "@/repositories/PredicateFactory";

export type Connection = {
  socket: Socket;
  lastHeardBack: Temporal.Instant;
  watchedContainerId?: string;
  filterPredicate?: (candidate: PredicateFactory.Candidate) => boolean;
};
