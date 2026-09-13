import { ZodParser } from "@/helpers/ZodParser";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Host } from "@/models/Host";
import z from "zod/v4";
import { Svc } from "../Svc";

export type ServerMessage = ServerMessage.Svcs | ServerMessage.HostSample | ServerMessage.Log;

export namespace ServerMessage {
  export enum Type {
    svcs = "svcs",
    host = "host",
    event = "event",
  }

  export type Svcs = {
    type: Type.svcs;
    svcs: Svc[];
  };

  export type HostSample = {
    type: Type.host;
    host: Host;
  };

  export type Log = {
    type: Type.event;
    data: ContainerEvent;
  };

  export const parse = ZodParser.forType<ServerMessage>()
    .ensureSchemaMatchesType(() => {
      return z.union([
        z.object({
          type: z.literal(Type.svcs),
          svcs: z.array(Svc.parse.SCHEMA),
        }),
        z.object({
          type: z.literal(Type.host),
          host: Host.parse.SCHEMA,
        }),
        z.object({
          type: z.literal(Type.event),
          data: ContainerEvent.parse.SCHEMA,
        }),
      ]);
    })
    .ensureTypeMatchesSchema();
}
