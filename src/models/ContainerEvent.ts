import { ZodParser } from "@/helpers/ZodParser";
import { Temporal } from "@js-temporal/polyfill";
import z from "zod/v4";
import { Container } from "./Container";
import { StreamVariant } from "./StreamVariant";

export type ContainerEvent = ContainerEvent.Start | ContainerEvent.Stop | ContainerEvent.Log | ContainerEvent.LogThrottle;

export namespace ContainerEvent {
  export enum Type {
    start = "start",
    stop = "stop",
    log = "log",
    log_throttle = "log_throttle",
  }

  type Common = {
    object: "container_event";
    /**
     * A uuidv7, minted where the event is born rather than where it is stored, so a line still on
     * its way to the database can already be named. Being time-ordered, sorting by it sorts by age.
     */
    id: string;
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
    streamVariant: StreamVariant;
    line: string;
  };

  export type LogThrottle = Common & {
    type: Type.log_throttle;
    foldCount: number;
  };

  const common = {
    object: z.literal("container_event"),
    id: z.string(),
    timestamp: z.string().transform(ZodParser.instant),
    container: Container.parse.SCHEMA,
  };

  export const parse = ZodParser.forType<ContainerEvent>()
    .ensureSchemaMatchesType(() =>
      z.discriminatedUnion("type", [
        z.object({
          ...common,
          type: z.literal(Type.start),
        }),
        z.object({
          ...common,
          type: z.literal(Type.stop),
        }),
        z.object({
          ...common,
          type: z.literal(Type.log),
          streamVariant: z.enum(StreamVariant),
          line: z.string(),
        }),
        z.object({
          ...common,
          type: z.literal(Type.log_throttle),
          foldCount: z.number(),
        }),
      ]),
    )
    .ensureTypeMatchesSchema();
}
