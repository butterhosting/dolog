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
    message: string;
  };

  export type LogThrottle = Common & {
    type: Type.log_throttle;
    foldCount: number;
  };

  const common = {
    timestamp: z.string().transform(ZodParser.instant),
    container: Container.parse.SCHEMA,
  };

  export const parse = ZodParser.forType<ContainerEvent>()
    .ensureSchemaMatchesType(() =>
      z.discriminatedUnion("type", [
        z.object({
          ...common,
          type: z.literal(Type.start),
          object: z.literal("container_event"),
        }),
        z.object({
          ...common,
          type: z.literal(Type.stop),
          object: z.literal("container_event"),
        }),
        z.object({
          ...common,
          type: z.literal(Type.log),
          object: z.literal("container_event"),
          streamVariant: z.enum(StreamVariant),
          message: z.string(),
        }),
        z.object({
          ...common,
          type: z.literal(Type.log_throttle),
          object: z.literal("container_event"),
          foldCount: z.number(),
        }),
      ]),
    )
    .ensureTypeMatchesSchema();
}
