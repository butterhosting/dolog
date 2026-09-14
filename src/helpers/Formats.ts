import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod/v4";

export namespace Formats {
  export const POSITIVE_INTEGER = z
    .string()
    .regex(/^[1-9]\d*$/, { error: "invalid_positive_integer" })
    .transform(Number);

  // an ISO-8601 duration, so "P30D" and "PT12H" both say what they mean without a unit suffix
  export const DURATION = z
    .string()
    .refine(
      (value) => {
        try {
          Temporal.Duration.from(value);
          return true;
        } catch {
          return false;
        }
      },
      { error: "invalid_duration" },
    )
    .transform((value) => Temporal.Duration.from(value));
}
