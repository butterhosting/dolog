import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";

/**
 * What a browser may send us. Only one thing so far: which container's events it wants pushed.
 *
 * Sockets receive the container overview regardless -- every page cares about that -- but log events
 * are only relayed to the sockets that asked, so opening one container does not mean paying for the
 * traffic of all the others.
 */
export type ClientMessage = ClientMessage.Watch;

export namespace ClientMessage {
  export enum Type {
    watch = "watch",
  }

  export type Watch = {
    type: Type.watch;
    /** The docker id to follow, or null to stop following anything. */
    containerId: string | null;
  };

  export const parse = ZodParser.forType<ClientMessage>()
    .ensureSchemaMatchesType(() =>
      z.union([
        z.object({
          type: z.literal(Type.watch),
          containerId: z.string().nullable(),
        }),
      ]),
    )
    .ensureTypeMatchesSchema();
}
