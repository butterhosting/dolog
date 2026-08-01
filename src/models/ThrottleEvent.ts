import { Temporal } from "@js-temporal/polyfill";
import { Container } from "./Container";

export type ThrottleEvent = {
  object: "throttle_event";
  timestamp: Temporal.Instant;
  container: Container;
  foldCount: number;
};
