import { Temporal } from "@js-temporal/polyfill";
import { isAbsolute, join } from "path";
import { z } from "zod/v4";
import packageJson from "../package.json";
import { Timezone } from "./helpers/Timezone";
import { ZodParser } from "./helpers/ZodParser";
import { LogLevel } from "./models/internal/LogLevel";
import { Webhook } from "./models/Webhook";
import { SupportToken } from "./support/SupportToken";
import { ExtractBetter } from "./types/ExtractBetter";

export namespace Env {
  export const Schema = z.object({
    DOLOG_STAGE: z.enum(["dev", "e2e", "prod"]),
    DOLOG_TIMEZONE: z.string().refine((tz) => Timezone.check(tz), {
      error: "invalid_timezone",
    }),

    DOLOG_ROOT: z.string(),
    DOLOG_LOGGING: z.enum(LogLevel),
    DOLOG_DEMO: ZodParser.boolean(),
    DOLOG_DOCKER_SOCKET: z.string(),
    DOLOG_SUPPORT_TOKEN: z.string().optional(),
    DOLOG_VERIFICATION_KEY: z.string().transform((str) => str.replaceAll("\\n", "\n")),

    DOLOG_THROTTLING_LOGS_PER_SECOND: ZodParser.positiveInteger(),
    DOLOG_RETENTION_TIME_WINDOW: ZodParser.duration(),
    DOLOG_RETENTION_MAX_LINES: ZodParser.positiveInteger(),

    DOLOG_WEBHOOKS: zWebhooks(),
    DOLOG_ALERTING_WEBHOOK_REF: ZodParser.optional(z.string()),
    DOLOG_ALERTING_TEXT_PATTERN: ZodParser.optional(ZodParser.regex()),
    DOLOG_ALERTING_THROUGHPUT_THRESHOLD: ZodParser.optional(ZodParser.positiveInteger()),
    DOLOG_ALERTING_COOLDOWN_WINDOW: ZodParser.duration(),
  });

  export type Defaultable = ExtractBetter<
    keyof z.input<typeof Schema>,
    | "DOLOG_TIMEZONE"
    | "DOLOG_LOGGING"
    | "DOLOG_DEMO"
    | "DOLOG_DOCKER_SOCKET"
    | "DOLOG_THROTTLING_LOGS_PER_SECOND"
    | "DOLOG_RETENTION_MAX_LINES"
    | "DOLOG_RETENTION_TIME_WINDOW"
    | "DOLOG_WEBHOOKS"
    | "DOLOG_ALERTING_WEBHOOK_REF"
    | "DOLOG_ALERTING_TEXT_PATTERN"
    | "DOLOG_ALERTING_THROUGHPUT_THRESHOLD"
    | "DOLOG_ALERTING_COOLDOWN_WINDOW"
  >;
  export const Defaults: Record<Defaultable, string> = {
    DOLOG_TIMEZONE: "UTC",
    DOLOG_LOGGING: "info",
    DOLOG_DEMO: "false",
    DOLOG_DOCKER_SOCKET: "/var/run/docker.sock",
    DOLOG_THROTTLING_LOGS_PER_SECOND: "100",
    DOLOG_RETENTION_TIME_WINDOW: "180d",
    DOLOG_RETENTION_MAX_LINES: "100000",
    DOLOG_WEBHOOKS: "",
    DOLOG_ALERTING_WEBHOOK_REF: "",
    DOLOG_ALERTING_TEXT_PATTERN: "",
    DOLOG_ALERTING_THROUGHPUT_THRESHOLD: "",
    DOLOG_ALERTING_COOLDOWN_WINDOW: "30m",
  };

  export function initialize(timezone = Temporal.Now.timeZoneId() as "UTC", environment: Record<string, string | undefined> = Bun.env) {
    if (timezone !== "UTC") {
      throw new Error(`Invalid timezone: ${timezone}`);
    }
    const { provided, merged } = withDefaults(environment);
    return Schema.transform(({ DOLOG_ROOT, DOLOG_SUPPORT_TOKEN, DOLOG_VERIFICATION_KEY, ...env }) => ({
      ...env,
      DOLOG_ROOT: isAbsolute(DOLOG_ROOT) ? DOLOG_ROOT : join(process.cwd(), DOLOG_ROOT),
      DOLOG_SUPPORTER: Boolean(SupportToken.verify({ hexToken: DOLOG_SUPPORT_TOKEN, publicKey: DOLOG_VERIFICATION_KEY })),
    }))
      .transform((env) => ({
        ...env,
        DOLOG_COMMIT: packageJson.commit.slice(0, 7),
        DOLOG_VERSION: packageJson.version,
        DOLOG_HTPASSWD: join(env.DOLOG_ROOT, ".htpasswd"),
        DOLOG_DATABASE: env.DOLOG_DEMO ? ":memory:" : join(env.DOLOG_ROOT, "data", "db.sqlite"),
        DOLOG_CONTAINER_LABEL_PREFIX: "dolog.",
        DOLOG_PROVIDED: provided,
      }))
      .parse(merged);
  }
  initialize.partiallyForLogger = (environment: Record<string, string | undefined> = Bun.env) => {
    const { merged } = withDefaults(environment);
    return Schema.partial()
      .required({
        DOLOG_TIMEZONE: true,
        DOLOG_LOGGING: true,
      })
      .parse(merged);
  };

  export type Private = ReturnType<typeof initialize>;
  export type Public = Readonly<
    Pick<Private, "DOLOG_STAGE" | "DOLOG_TIMEZONE" | "DOLOG_COMMIT" | "DOLOG_VERSION" | "DOLOG_SUPPORTER" | "DOLOG_DEMO">
  >;
  export function onlyPublic(env: Private): Public {
    return {
      DOLOG_STAGE: env.DOLOG_STAGE,
      DOLOG_TIMEZONE: env.DOLOG_TIMEZONE,
      DOLOG_COMMIT: env.DOLOG_COMMIT,
      DOLOG_VERSION: env.DOLOG_VERSION,
      DOLOG_SUPPORTER: env.DOLOG_SUPPORTER,
      DOLOG_DEMO: env.DOLOG_DEMO,
    };
  }

  // v-- helper functions --v

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

  function zWebhooks() {
    return z.string().transform((value, ctx) => {
      const webhooks: Record<string, Webhook> = {};
      for (const entry of value.split(/\s+/).filter((entry) => entry.length > 0)) {
        const separator = entry.indexOf("=");
        const name = separator > 0 ? entry.slice(0, separator) : "";
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
          ctx.addIssue({ code: "custom", message: `invalid_webhook_name: ${entry}` });
          return z.NEVER;
        }
        let url: URL;
        try {
          url = new URL(entry.slice(separator + 1));
        } catch {
          ctx.addIssue({ code: "custom", message: `invalid_webhook_url: ${name}` });
          return z.NEVER;
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          ctx.addIssue({ code: "custom", message: `invalid_webhook_url: ${name}` });
          return z.NEVER;
        }
        // fetch refuses a URL that carries credentials, so they travel as a header instead
        const auth = url.username ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : undefined;
        url.username = "";
        url.password = "";
        webhooks[name] = { url: url.toString(), auth };
      }
      return webhooks;
    });
  }
}
