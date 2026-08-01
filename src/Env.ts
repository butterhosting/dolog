import { Temporal } from "@js-temporal/polyfill";
import { isAbsolute, join } from "path";
import { z } from "zod/v4";
import packageJson from "../package.json";
import { TimeZone } from "./helpers/TimeZone";
import { LogLevel } from "./models/internal/LogLevel";

export namespace Env {
  const baseEnv = z.object({
    O_DOLOG_STAGE: z.enum(["dev", "e2e", "prod"]),
    O_DOLOG_TIMEZONE: z.string().refine((tz) => TimeZone.check(tz), {
      error: "invalid_timezone",
    }),

    X_DOLOG_ROOT: z.string(),
    X_DOLOG_LOGGING: z.enum(LogLevel),
    X_DOLOG_DOCKER_SOCKET: z.string(),
    X_DOLOG_THROTTLE_LOGS_PER_SECOND: z.string().regex(/^[1-9]\d*$/),
  });

  export function initializePartiallyForLogger(environment = Bun.env) {
    return baseEnv
      .partial()
      .required({
        O_DOLOG_TIMEZONE: true,
        X_DOLOG_LOGGING: true,
      })
      .parse(environment);
  }

  export function initialize(timezone = Temporal.Now.timeZoneId() as "UTC", environment = Bun.env as z.output<typeof baseEnv>) {
    if (timezone !== "UTC") {
      throw new Error(`Invalid timezone: ${timezone}`);
    }
    return baseEnv
      .transform(({ X_DOLOG_ROOT, ...env }) => ({
        ...env,
        X_DOLOG_ROOT: isAbsolute(X_DOLOG_ROOT) ? X_DOLOG_ROOT : join(process.cwd(), X_DOLOG_ROOT),
      }))
      .transform((env) => ({
        ...env,
        O_DOLOG_COMMIT: packageJson.commit.slice(0, 7),
        O_DOLOG_VERSION: packageJson.version,
        X_DOLOG_THROTTLE_LOGS_PER_SECOND: Number(env.X_DOLOG_THROTTLE_LOGS_PER_SECOND),
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
