import { Temporal } from "@js-temporal/polyfill";
import { isAbsolute, join } from "path";
import { z } from "zod/v4";
import packageJson from "../package.json";
import { Timezone } from "./helpers/Timezone";
import { ZodParser } from "./helpers/ZodParser";
import { LogLevel } from "./models/internal/LogLevel";
import { ExtractBetter } from "./types/ExtractBetter";

export namespace Env {
  export const Schema = z.object({
    O_DOLOG_STAGE: z.enum(["dev", "e2e", "prod"]),
    O_DOLOG_TIMEZONE: z.string().refine((tz) => Timezone.check(tz), {
      error: "invalid_timezone",
    }),

    X_DOLOG_ROOT: z.string(),
    X_DOLOG_LOGGING: z.enum(LogLevel),
    X_DOLOG_DOCKER_SOCKET: z.string(),

    X_DOLOG_THROTTLING_LOGS_PER_SECOND: ZodParser.positiveInteger(),
    X_DOLOG_RETENTION_TIME_WINDOW: ZodParser.duration(),
    X_DOLOG_RETENTION_MAX_LINES: ZodParser.positiveInteger(),
  });

  export type Defaultable = ExtractBetter<
    keyof z.input<typeof Schema>,
    | "O_DOLOG_TIMEZONE"
    | "X_DOLOG_LOGGING"
    | "X_DOLOG_DOCKER_SOCKET"
    | "X_DOLOG_THROTTLING_LOGS_PER_SECOND"
    | "X_DOLOG_RETENTION_MAX_LINES"
    | "X_DOLOG_RETENTION_TIME_WINDOW"
  >;
  export const Defaults: Record<Defaultable, string> = {
    O_DOLOG_TIMEZONE: "UTC",
    X_DOLOG_LOGGING: "info",
    X_DOLOG_DOCKER_SOCKET: "/var/run/docker.sock",
    X_DOLOG_THROTTLING_LOGS_PER_SECOND: "100",
    X_DOLOG_RETENTION_TIME_WINDOW: "180d",
    X_DOLOG_RETENTION_MAX_LINES: "100000",
  };

  export function initialize(timezone = Temporal.Now.timeZoneId() as "UTC", environment: Record<string, string | undefined> = Bun.env) {
    if (timezone !== "UTC") {
      throw new Error(`Invalid timezone: ${timezone}`);
    }
    const { provided, merged } = withDefaults(environment);
    return Schema.transform(({ X_DOLOG_ROOT, ...env }) => ({
      ...env,
      X_DOLOG_ROOT: isAbsolute(X_DOLOG_ROOT) ? X_DOLOG_ROOT : join(process.cwd(), X_DOLOG_ROOT),
    }))
      .transform((env) => ({
        ...env,
        O_DOLOG_COMMIT: packageJson.commit.slice(0, 7),
        O_DOLOG_VERSION: packageJson.version,
        X_DOLOG_DATABASE: join(env.X_DOLOG_ROOT, "data", "db.sqlite"),
        X_DOLOG_CONTAINER_LABEL_PREFIX: "dolog.",
        X_DOLOG_PROVIDED: provided,
      }))
      .parse(merged);
  }
  initialize.partiallyForLogger = (environment: Record<string, string | undefined> = Bun.env) => {
    const { merged } = withDefaults(environment);
    return Schema.partial()
      .required({
        O_DOLOG_TIMEZONE: true,
        X_DOLOG_LOGGING: true,
      })
      .parse(merged);
  };

  function withDefaults(environment: Record<string, string | undefined>) {
    const provided: Partial<Record<Defaultable, string>> = {};
    const merged = { ...environment };
    for (const key of Object.keys(Defaults) as Defaultable[]) {
      const value = environment[key];
      if (value) {
        provided[key] = value;
      } else {
        merged[key] = Defaults[key];
      }
    }
    return { provided, merged };
  }

  type PublicPrefix = "O_DOLOG_";
  export function isPublic(key: string) {
    return key.startsWith("O_DOLOG_" satisfies PublicPrefix);
  }

  export type Private = ReturnType<typeof initialize>;
  export type Public = Readonly<{
    [K in keyof Private as K extends `${PublicPrefix}${string}` ? K : never]: Private[K] extends z.ZodTypeAny
      ? z.output<Private[K]>
      : Private[K];
  }>;

  export type RealEnvName<K extends string> = K extends `${"X" | "O"}_${infer Rest}` ? Rest : K;
  export function realEnvName<K extends string>(key: K): RealEnvName<K> {
    return key.replace(/^[XO]_/, "") as RealEnvName<K>;
  }
}
