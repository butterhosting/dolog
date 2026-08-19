import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";
import { Filter } from "../Filter";

export type ClientMessage = ClientMessage.DeclareStreamInterest;

export namespace ClientMessage {
  export enum Type {
    declare_stream_interest = "declare_stream_interest",
  }

  export type DeclareStreamInterest = {
    type: Type.declare_stream_interest;
    containerId?: string;
    filter?: Filter;
  };

  export const parse = ZodParser.forType<ClientMessage>()
    .ensureSchemaMatchesType(() =>
      z.union([
        z.object({
          type: z.literal(Type.declare_stream_interest),
          containerId: z.string().optional(),
          filter: Filter.parse.SCHEMA.optional(),
        }),
      ]),
    )
    .ensureTypeMatchesSchema();
}
