import { ZodParser } from "@/helpers/ZodParser";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerRM } from "@/models/ContainerRM";
import z from "zod/v4";

export type ServerMessage = ServerMessage.Containers | ServerMessage.Log;

export namespace ServerMessage {
  export enum Type {
    containers = "containers",
    event = "event",
  }

  export type Containers = {
    type: Type.containers;
    containers: ContainerRM[];
  };

  export type Log = {
    type: Type.event;
    data: ContainerEvent;
  };

  export const parse = ZodParser.forType<ServerMessage>()
    .ensureSchemaMatchesType(() => {
      return z.union([
        z.object({
          type: z.literal(Type.containers),
          containers: z.array(ContainerRM.parse.SCHEMA),
        }),
        z.object({
          type: z.literal(Type.event),
          data: ContainerEvent.parse.SCHEMA,
        }),
      ]);
    })
    .ensureTypeMatchesSchema();
}
