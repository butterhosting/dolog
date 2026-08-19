import { Temporal } from "@js-temporal/polyfill";
import { Pattern } from "./Pattern";
import { ZodParser } from "@/helpers/ZodParser";
import { z } from "zod/v4";

export type Filter = {
  pattern?: Pattern;
  since?: Temporal.Instant;
  until?: Temporal.Instant;
};

export namespace Filter {
  export const parse = ZodParser.forType<Filter>()
    .ensureSchemaMatchesType(() =>
      z.object({
        pattern: Pattern.parse.SCHEMA.optional(),
        since: z.string().transform(ZodParser.instant).optional(),
        until: z.string().transform(ZodParser.instant).optional(),
      }),
    )
    .ensureTypeMatchesSchema();
}
