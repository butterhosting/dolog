import { PredicateFactory } from "@/repositories/PredicateFactory";
import { Temporal } from "@js-temporal/polyfill";
import { Svc } from "../Svc";
import { Socket } from "./Socket";

export type Connection = {
  socket: Socket;
  lastHeardBack: Temporal.Instant;
  watchedSvcId?: Svc.Id;
  filterPredicate?: (candidate: PredicateFactory.Candidate) => boolean;
  filterDropThrottleEvents: boolean;
};
