import { ZodParser } from "@/helpers/ZodParser";
import { LogLinePattern } from "@/models/LogLinePattern";
import z from "zod/v4";

export type ClientMessage = ClientMessage.DeclareStreamInterest;

export namespace ClientMessage {
  export enum Type {
    declare_stream_interest = "declare_stream_interest",
  }

  export type DeclareStreamInterest = {
    type: Type.declare_stream_interest;
    containerId: string | null;
    logLinePattern: LogLinePattern | null;
  };

  export const parse = ZodParser.forType<ClientMessage>()
    .ensureSchemaMatchesType(() =>
      z.union([
        z.object({
          type: z.literal(Type.declare_stream_interest),
          containerId: z.string().nullable(),
          logLinePattern: LogLinePattern.parse.SCHEMA.nullable(),
        }),
      ]),
    )
    .ensureTypeMatchesSchema();
}
