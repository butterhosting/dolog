import { ZodParser } from "@/helpers/ZodParser";
import { LogPattern } from "@/models/LogPattern";
import z from "zod/v4";

export type ClientMessage = ClientMessage.DeclareStreamInterest;

export namespace ClientMessage {
  export enum Type {
    declare_stream_interest = "declare_stream_interest",
  }

  export type DeclareStreamInterest = {
    type: Type.declare_stream_interest;
    containerId?: string;
    logPattern?: LogPattern;
  };

  export const parse = ZodParser.forType<ClientMessage>()
    .ensureSchemaMatchesType(() =>
      z.union([
        z.object({
          type: z.literal(Type.declare_stream_interest),
          containerId: z.string().optional(),
          logPattern: LogPattern.parse.SCHEMA.optional(),
        }),
      ]),
    )
    .ensureTypeMatchesSchema();
}
