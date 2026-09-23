import { ZodParser } from "@/helpers/ZodParser";
import { Temporal } from "@js-temporal/polyfill";
import z from "zod/v4";
import { Svc } from "./Svc";

export type Alert = Alert.Text | Alert.Throughput;

export namespace Alert {
  export enum Type {
    text = "text",
    throughput = "throughput",
  }

  type Common = {
    id: string; // UUIDv7
    object: "alert";
    service: Pick<Svc, "id" | "dname" | "dgroup"> & { link: string };
    timestamp: Temporal.Instant;
  };

  export type Text = Common & {
    type: Type.text;
    containerEventId: string;
    match: {
      pattern: string;
      line: string;
    };
  };

  export type Throughput = Common & {
    type: Type.throughput;
    breach: {
      threshold: number;
      logsPerSecond: number;
    };
  };

  const common = {
    id: z.uuidv7(),
    object: z.literal("alert"),
    timestamp: z.string().transform(ZodParser.instant),
    service: z.object({
      id: z.string(),
      link: z.string(),
      dname: z.string(),
      dgroup: z.string().optional(),
    }),
  };

  export const parse = ZodParser.forType<Alert>()
    .ensureSchemaMatchesType(() =>
      z.discriminatedUnion("type", [
        z.object({
          ...common,
          type: z.literal(Type.text),
          containerEventId: z.uuidv7(),
          match: z.object({
            pattern: z.string(),
            line: z.string(),
          }),
        }),
        z.object({
          ...common,
          type: z.literal(Type.throughput),
          breach: z.object({
            threshold: z.number(),
            logsPerSecond: z.number(),
          }),
        }),
      ]),
    )
    .ensureTypeMatchesSchema();
}
