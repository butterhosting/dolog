import { Env } from "@/Env";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod/v4";

export type ContainerLabelConfig = {
  throttlingLogsPerSecond: number;
  retentionTimeWindow: Temporal.Duration;
  retentionMaxLines: number;
};

export namespace ContainerLabelConfig {
  // `satisfies` rather than a type annotation
  export const Settings = {
    throttlingLogsPerSecond: setting("throttling.logs-per-second", Env.Schema.shape.X_DOLOG_THROTTLING_LOGS_PER_SECOND),
    retentionTimeWindow: setting("retention.time-window", Env.Schema.shape.X_DOLOG_RETENTION_TIME_WINDOW),
    retentionMaxLines: setting("retention.max-lines", Env.Schema.shape.X_DOLOG_RETENTION_MAX_LINES),
  } satisfies { [K in keyof ContainerLabelConfig]: Setting<string, ContainerLabelConfig[K]> };

  type Source = "label" | "env";
  type Issue = {
    label: string;
    value: string;
    reason: string;
  };
  type Resolution = {
    config: ContainerLabelConfig;
    sources: Record<keyof ContainerLabelConfig, Source>;
    issues: Issue[];
  };

  export function resolve(env: Env.Private, dlabels: Record<string, string>): Resolution {
    const config: Partial<Record<keyof ContainerLabelConfig, unknown>> = {};
    const sources: Partial<Resolution["sources"]> = {};
    const issues: Issue[] = [];
    for (const key of Object.keys(Settings) as Array<keyof ContainerLabelConfig>) {
      const { name, envKey, schema } = Settings[key];
      const raw = dlabels[name];
      const parsed = raw === undefined ? undefined : schema.safeParse(raw);
      if (parsed?.success) {
        config[key] = parsed.data;
        sources[key] = "label";
        continue;
      }
      if (parsed) {
        issues.push({
          label: `${env.X_DOLOG_CONTAINER_LABEL_PREFIX}${name}`,
          value: raw!,
          reason: parsed.error.issues.map((issue) => issue.message).join("; "),
        });
      }
      config[key] = env[envKey];
      sources[key] = "env";
    }
    return {
      config: config as ContainerLabelConfig,
      sources: sources as Resolution["sources"],
      issues,
    };
  }

  export function envKeyOf<Name extends string>(name: Name): EnvKey<Name> {
    return `X_DOLOG_${name.replaceAll(/[.-]/g, "_").toUpperCase()}` as EnvKey<Name>;
  }

  type Underscored<S extends string> = S extends `${infer Head}${"." | "-"}${infer Tail}` ? `${Head}_${Underscored<Tail>}` : S;
  type EnvKey<Name extends string> = `X_DOLOG_${Uppercase<Underscored<Name>>}`;

  type Setting<Name extends string, T> = {
    name: Name;
    envKey: EnvKey<Name> & keyof Env.Private;
    schema: z.ZodType<T, string>;
  };

  // `T` must be what the env var holds, which rules out any name whose env var does not exist (its value type is `never`)
  function setting<Name extends string, T extends Env.Private[EnvKey<Name> & keyof Env.Private]>(
    name: Name,
    schema: z.ZodType<T, string>,
  ): Setting<Name, T> {
    return { name, envKey: envKeyOf(name) as EnvKey<Name> & keyof Env.Private, schema };
  }
}
