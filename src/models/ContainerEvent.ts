import { ZodParser } from "@/helpers/ZodParser";
import { Temporal } from "@js-temporal/polyfill";
import z from "zod/v4";
import { Container } from "./Container";

export type ContainerEvent =
  | ContainerEvent.Start //
  | ContainerEvent.Stop
  | ContainerEvent.Log
  | ContainerEvent.Throttle;

export namespace ContainerEvent {
  export enum Type {
    start = "start",
    stop = "stop",
    log = "log",
    throttle = "throttle",
  }

  export enum Stream {
    stdout = "stdout",
    stderr = "stderr",
  }

  type Common = {
    timestamp: Temporal.Instant;
    container: Container;
  };

  export type Start = Common & {
    type: Type.start;
  };

  export type Stop = Common & {
    type: Type.stop;
  };

  export type Log = Common & {
    type: Type.log;
    stream: Stream;
    message: string;
  };

  /**
   * Stands in for log lines the throttler dropped, so a chatty container degrades into a
   * visible gap rather than silently starving everything downstream.
   */
  export type Throttle = Common & {
    type: Type.throttle;
    foldCount: number;
  };

  const common = {
    timestamp: z.string().transform(ZodParser.instant),
    container: Container.parse.SCHEMA,
  };

  export const parse = ZodParser.forType<ContainerEvent>()
    .ensureSchemaMatchesType(() =>
      z.discriminatedUnion("type", [
        z.object({ ...common, type: z.literal(Type.start) }),
        z.object({ ...common, type: z.literal(Type.stop) }),
        z.object({ ...common, type: z.literal(Type.log), stream: z.enum(Stream), message: z.string() }),
        z.object({ ...common, type: z.literal(Type.throttle), foldCount: z.number() }),
      ]),
    )
    .ensureTypeMatchesSchema();
}
