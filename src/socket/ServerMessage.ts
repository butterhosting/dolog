import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

export type ServerMessage = ServerMessage.Heartbeat;

export namespace ServerMessage {
  export enum Type {
    heartbeat = "heartbeat",
  }

  export type Heartbeat = {
    type: Type.heartbeat;
    timestamp: string;
  };

  export const parse = ZodParser.forType<ServerMessage>()
    .ensureSchemaMatchesType(() => {
      return z.union([
        z.object({
          type: z.literal(Type.heartbeat),
          timestamp: z.string(),
        }),
      ]);
    })
    .ensureTypeMatchesSchema();
}
