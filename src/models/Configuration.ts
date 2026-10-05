import type { Env } from "@/Env";
import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";
import { Svc } from "./Svc";

export type Configuration = {
  settings: Configuration.Setting[];
};

export namespace Configuration {
  // the demo flag has a default too, but it is a way of trying dolog rather than a setting of it
  export type EnvVar = Exclude<Env.Defaultable, "INTERACTIVE_DEMO">;
  export type LabelName = typeof Svc.DISPLAY_GROUP_LABEL;
  export type Key = EnvVar | LabelName;

  export type Setting = EnvSetting | LabelSetting;

  export type EnvSetting = {
    envVar: EnvVar;
    envValue?: string;
    defaultValue: string;
    containerLabel?: ContainerLabel;
  };

  /** Only means something for one container at a time, so there is no environment variable behind it */
  export type LabelSetting = {
    labelName: LabelName;
    containerLabel: ContainerLabel;
  };

  export type ContainerLabel = {
    name: string;
    overrides: Array<{
      dname: string;
      dgroup?: string;
      value: string;
      valid: boolean; // an unreadable value is still shown, but the environment applies instead
      stopped: boolean;
    }>;
  };

  export function keyOf(setting: Setting): Key {
    return "envVar" in setting ? setting.envVar : setting.labelName;
  }

  export const parse = ZodParser.forType<Configuration>()
    .ensureSchemaMatchesType(() => {
      const containerLabel = z.object({
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
      });
      return z.object({
        settings: z.array(
          z.union([
            z.object({
              envVar: z.custom<EnvVar>((value) => typeof value === "string"),
              envValue: z.string().optional(),
              defaultValue: z.string(),
              containerLabel: containerLabel.optional(),
            }),
            z.object({
              labelName: z.literal(Svc.DISPLAY_GROUP_LABEL),
              containerLabel,
            }),
          ]),
        ),
      });
    })
    .ensureTypeMatchesSchema();
}
