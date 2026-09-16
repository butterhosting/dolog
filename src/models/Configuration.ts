import type { Env } from "@/Env";
import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

export type Configuration = {
  settings: Configuration.Setting[];
};

export namespace Configuration {
  export type EnvVar = Env.RealEnvName<Env.Defaultable>;

  export type Setting = {
    envVar: EnvVar;
    envValue?: string;
    defaultValue: string;
    containerLabel?: {
      name: string;
      overrides: Array<{
        dname: string;
        dgroup?: string;
        value: string;
        valid: boolean; // an unreadable value is still shown, but the environment applies instead
        stopped: boolean;
      }>;
    };
  };

  export const parse = ZodParser.forType<Configuration>()
    .ensureSchemaMatchesType(() =>
      z.object({
        settings: z.array(
          z.object({
            envVar: z.custom<EnvVar>((value) => typeof value === "string"),
            envValue: z.string().optional(),
            defaultValue: z.string(),
            containerLabel: z
              .object({
                name: z.string(),
                overrides: z.array(
                  z.object({
                    dname: z.string(),
                    dgroup: z.string().optional(),
                    value: z.string(),
                    valid: z.boolean(),
                    stopped: z.boolean(),
                  }),
                ),
              })
              .optional(),
          }),
        ),
      }),
    )
    .ensureTypeMatchesSchema();
}
