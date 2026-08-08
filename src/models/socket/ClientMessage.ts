import { LineMatch } from "@/helpers/LineMatch";
import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

export type ClientMessage = ClientMessage.DeclareStreamInterest;

export namespace ClientMessage {
  export enum Type {
    declare_stream_interest = "declare_stream_interest",
  }

  export type DeclareStreamInterest = {
    type: Type.declare_stream_interest;
    containerId: string | null;
    logsFilter: {
      pattern: string;
      variant: LineMatch.Variant;
    } | null;
  };

  export const parse = ZodParser.forType<ClientMessage>()
    .ensureSchemaMatchesType(() =>
      z.union([
        z.object({
          type: z.literal(Type.declare_stream_interest),
          containerId: z.string().nullable(),
          logsFilter: z
            .object({
              pattern: z.string(),
              variant: z.enum(["substr", "regex"] satisfies LineMatch.Variant[]),
            })
            .nullable(),
        }),
      ]),
    )
    .ensureTypeMatchesSchema();
}
