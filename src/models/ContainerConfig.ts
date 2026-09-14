import { Env } from "@/Env";
import { Formats } from "@/helpers/Formats";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod/v4";

export type ContainerConfig = {
  throttleLogsPerSecond: number;
  retentionTimeWindow: Temporal.Duration;
  retentionMaxLines: number;
};

export namespace ContainerConfig {
  // Every setting has one canonical `topic.key-words` name
  const SETTINGS = {
    throttleLogsPerSecond: setting("throttle.logs-per-second", Formats.POSITIVE_INTEGER),
    retentionTimeWindow: setting("retention.time-window", Formats.DURATION),
    retentionMaxLines: setting("retention.max-lines", Formats.POSITIVE_INTEGER),
  } satisfies { [K in keyof ContainerConfig]: Setting<string, ContainerConfig[K]> };

  type Source = "label" | "env";
  type Issue = { label: string; value: string; reason: string }; // the label key as the operator wrote it, prefix included
  type Resolution = {
    config: ContainerConfig;
    sources: { [K in keyof ContainerConfig]: Source };
    issues: Issue[]; // labels that could not be read
  };

  /** Labels win over env; a label that does not parse is reported, and the env default stands in for it */
  export function resolve(env: Env.Private, dlabels: Record<string, string>): Resolution {
    const config: Partial<Record<keyof ContainerConfig, unknown>> = {};
    const sources: Partial<Resolution["sources"]> = {};
    const issues: Issue[] = [];
    for (const key of Object.keys(SETTINGS) as Array<keyof ContainerConfig>) {
      const { name, envKey, schema } = SETTINGS[key];
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
    // built key by key above, where the union of setting types keeps the compiler from seeing each key's own type
    return {
      config: config as ContainerConfig,
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
