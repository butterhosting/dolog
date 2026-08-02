import { ZodParser } from "@/helpers/ZodParser";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import z from "zod/v4";

export type ServerMessage = ServerMessage.Containers | ServerMessage.Event;

export namespace ServerMessage {
  export enum Type {
    containers = "containers",
    log = "log",
  }

  /**
   * The set of known containers, pushed whenever it changes so the overview can show one appearing
   * without waiting for its next poll.
   */
  export type Containers = {
    type: Type.containers;
    containers: Container[];
  };

  /** A single live event, relayed only to the sockets watching that container. */
  export type Event = {
    type: Type.log;
    event: ContainerEvent;
  };

  export const parse = ZodParser.forType<ServerMessage>()
    .ensureSchemaMatchesType(() => {
      return z.union([
        z.object({
          type: z.literal(Type.containers),
          containers: z.array(Container.parse.SCHEMA),
        }),
        z.object({
          type: z.literal(Type.log),
          event: ContainerEvent.parse.SCHEMA,
        }),
      ]);
    })
    .ensureTypeMatchesSchema();
}
