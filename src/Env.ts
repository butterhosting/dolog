import { Temporal } from "@js-temporal/polyfill";
import { isAbsolute, join } from "path";
import { z } from "zod/v4";
import packageJson from "../package.json";
import { Timezone } from "./helpers/Timezone";
import { LogLevel } from "./models/internal/LogLevel";

export namespace Env {
  const BASE_ENV = z.object({
    O_DOLOG_STAGE: z.enum(["dev", "e2e", "prod"]),
    O_DOLOG_TIMEZONE: z.string().refine((tz) => Timezone.check(tz), {
      error: "invalid_timezone",
    }),

    X_DOLOG_ROOT: z.string(),
    X_DOLOG_LOGGING: z.enum(LogLevel),
    X_DOLOG_DOCKER_SOCKET: z.string(),
    X_DOLOG_THROTTLE_LOGS_PER_SECOND: z.string().regex(/^[1-9]\d*$/),
    // an ISO-8601 duration, so "P30D" and "PT12H" both say what they mean without a unit suffix
    X_DOLOG_RETENTION_TIME_WINDOW: z.string().refine(
      (value) => {
        try {
          Temporal.Duration.from(value);
          return true;
        } catch {
          return false;
        }
      },
      { error: "invalid_duration" },
    ),
    X_DOLOG_RETENTION_MAX_LINES_PER_CONTAINER: z.string().regex(/^[1-9]\d*$/),
  });

  export function initializePartiallyForLogger(environment = Bun.env) {
    return BASE_ENV.partial()
      .required({
        O_DOLOG_TIMEZONE: true,
        X_DOLOG_LOGGING: true,
      })
      .parse(environment);
  }

  export function initialize(timezone = Temporal.Now.timeZoneId() as "UTC", environment = Bun.env as z.output<typeof BASE_ENV>) {
    if (timezone !== "UTC") {
      throw new Error(`Invalid timezone: ${timezone}`);
    }
    return BASE_ENV.transform(({ X_DOLOG_ROOT, ...env }) => ({
      ...env,
      X_DOLOG_ROOT: isAbsolute(X_DOLOG_ROOT) ? X_DOLOG_ROOT : join(process.cwd(), X_DOLOG_ROOT),
    }))
      .transform((env) => ({
        ...env,
        O_DOLOG_COMMIT: packageJson.commit.slice(0, 7),
        O_DOLOG_VERSION: packageJson.version,
        X_DOLOG_THROTTLE_LOGS_PER_SECOND: Number(env.X_DOLOG_THROTTLE_LOGS_PER_SECOND),
        X_DOLOG_RETENTION_TIME_WINDOW: Temporal.Duration.from(env.X_DOLOG_RETENTION_TIME_WINDOW),
        X_DOLOG_RETENTION_MAX_LINES_PER_CONTAINER: Number(env.X_DOLOG_RETENTION_MAX_LINES_PER_CONTAINER),
        X_DOLOG_DATABASE: join(env.X_DOLOG_ROOT, "data", "db.sqlite"),
        X_DOLOG_CONTAINER_LABEL_PREFIX: "ing.butterhost.",
      }))
      .parse(environment);
  }

  export type Private = ReturnType<typeof initialize>;

  export type Public = Readonly<{
    [K in keyof Private as K extends `${PublicPrefix}${string}` ? K : never]: Private[K] extends z.ZodTypeAny
      ? z.output<Private[K]>
      : Private[K];
  }>;
  export type PublicPrefix = "O_DOLOG_";
}
