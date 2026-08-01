import { Temporal } from "@js-temporal/polyfill";
import z, { ZodError } from "zod/v4";

type MustMatch<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? X : never) : never;

type ParserFactory<T, U> =
  MustMatch<T, U> extends never
    ? never
    : {
        ensureTypeMatchesSchema: () => {
          (json: unknown): T;
          SCHEMA: z.ZodType<T>;
        };
      };

export namespace ZodParser {
  export function instant(value: string, ctx: z.RefinementCtx): Temporal.Instant {
    try {
      return Temporal.Instant.from(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "invalid instant" });
      return z.NEVER;
    }
  }

  export function forType<T>() {
    return {
      ensureSchemaMatchesType<U extends z.ZodType<T>>(schemaFn: () => U): ParserFactory<T, z.output<U>> {
        const schema = schemaFn();
        function parseFn(json: unknown): T {
          try {
            return schema.parse(json);
          } catch (e: any) {
            if (e.name === ZodError.name) {
              const { issues } = e as ZodError;
              throw new Error(`JSON did not match Zod schema; ${JSON.stringify(issues, null, 2)}`);
            }
            throw e;
          }
        }
        parseFn.SCHEMA = schema;
        // @ts-ignore
        return {
          ensureTypeMatchesSchema() {
            return parseFn;
          },
        };
      },
    };
  }
}
