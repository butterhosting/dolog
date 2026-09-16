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

  export function duration() {
    return z
      .string()
      .regex(/^[1-9]\d*[smhd]$/, { error: "invalid_duration" })
      .transform((value) => {
        const amount = Number(value.slice(0, -1));
        const unit = value.slice(-1);
        switch (unit) {
          case "s":
            return Temporal.Duration.from({ seconds: amount });
          case "m":
            return Temporal.Duration.from({ minutes: amount });
          case "h":
            return Temporal.Duration.from({ hours: amount });
          case "d":
            return Temporal.Duration.from({ days: amount });
          default:
            throw new Error(`Unsupported duration unit: ${unit}`);
        }
      });
  }

  export function positiveInteger() {
    return z
      .string()
      .regex(/^[1-9]\d*$/, { error: "invalid_positive_integer" })
      .transform(Number);
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
