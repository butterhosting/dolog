import { ZodParser } from "@/helpers/ZodParser";
import { Temporal } from "@js-temporal/polyfill";
import z from "zod/v4";
import { Container } from "./Container";

/**
 * A container as the overview page needs it: who it is, when it last said anything, and how busy it
 * is right now.
 *
 * `lastSeen` deliberately lives here rather than on {@link Container}, because it moves every second
 * and would make the container stream republish on every batch. This is fetched, not pushed.
 */
export type ContainerOverview = {
  object: "container_overview";
  container: Container;
  /** Whether docker still has it. A stopped container stays listed while its history survives. */
  running: boolean;
  /** When it last logged, or null if it is running but has said nothing yet. */
  lastSeen: Temporal.Instant | null;
  logsPerSecond: number;
  throttling: boolean;
};

export namespace ContainerOverview {
  export const parse = ZodParser.forType<ContainerOverview>()
    .ensureSchemaMatchesType(() =>
      z.object({
        object: z.literal("container_overview"),
        container: Container.parse.SCHEMA,
        running: z.boolean(),
        lastSeen: z.string().transform(ZodParser.instant).nullable(),
        logsPerSecond: z.number(),
        throttling: z.boolean(),
      }),
    )
    .ensureTypeMatchesSchema();
}
