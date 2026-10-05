import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";
import { LiveStats } from "./LiveStats";

// "Docker Service"
export type Svc = {
  id: string;
  dname: string;
  dgroup?: string;
  mostRecentContainer: {
    dimage: string;
    dlabels: Record<string, string>;
    liveStats?: LiveStats; // presence/absence indicates online/offline
  };
};

export namespace Svc {
  export type Id = Pick<Svc, "dname" | "dgroup">;

  /** Under the configured prefix, like every label; it moves a service to another card, never to another identity */
  export const DISPLAY_GROUP_LABEL = "display.group";

  /** The card a service is listed under: its label when it has one (an empty one leaving it ungrouped), else its docker group */
  export function displayGroup({ dgroup, mostRecentContainer }: Pick<Svc, "dgroup" | "mostRecentContainer">): string | undefined {
    const label = mostRecentContainer.dlabels[DISPLAY_GROUP_LABEL];
    return label === undefined ? dgroup : label.trim() || undefined;
  }

  export function encodeId({ dname, dgroup }: Id): string {
    const marker = dgroup ? "1" : "0";
    const len = dname.length.toString().padStart(3, "0"); // dname ≤ 999 chars
    return new TextEncoder().encode(`${marker}${len}${dname}${dgroup ?? ""}`).toHex();
  }

  export function decodeId(id: string): Id {
    id = new TextDecoder().decode(Uint8Array.fromHex(id));
    const hasGroup = id[0] === "1";
    const len = Number(id.slice(1, 4));
    const dname = id.slice(4, 4 + len);
    const dgroup = hasGroup ? id.slice(4 + len) : undefined;
    return { dname, dgroup };
  }

  export function matches(svcId: string | Id, container: Pick<Svc, "dname" | "dgroup">): boolean {
    const id: Id = typeof svcId === "string" ? decodeId(svcId) : svcId;
    return id.dname === container.dname && (id.dgroup ?? undefined) === (container.dgroup ?? undefined);
  }

  export const parse = ZodParser.forType<Svc>()
    .ensureSchemaMatchesType(() =>
      z.object({
        id: z.string(),
        dname: z.string(),
        dgroup: z.string().optional(),
        mostRecentContainer: z.object({
          dimage: z.string(),
          dlabels: z.record(z.string(), z.string()),
          liveStats: LiveStats.parse.SCHEMA.optional(),
        }),
      }),
    )
    .ensureTypeMatchesSchema();
}
