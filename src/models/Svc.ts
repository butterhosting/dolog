import { ZodParser } from "@/helpers/ZodParser";
import z from "zod/v4";
import type { Container } from "./Container";

// "Docker Service"
export type Svc = {
  id: string;
  dname: string;
  dgroup?: string;
  online: boolean;
  throttling: boolean;
  logsPerSecond: number;
};

export namespace Svc {
  export type Id = Pick<Svc, "dname" | "dgroup">;

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

  export function matches(svcId: string | Id, container: Pick<Container, "dname" | "dgroup">): boolean {
    const id: Id = typeof svcId === "string" ? decodeId(svcId) : svcId;
    return id.dname === container.dname && (id.dgroup ?? undefined) === (container.dgroup ?? undefined);
  }

  export const parse = ZodParser.forType<Svc>()
    .ensureSchemaMatchesType(() =>
      z.object({
        id: z.string(),
        dname: z.string(),
        dgroup: z.string().optional(),
        online: z.boolean(),
        throttling: z.boolean(),
        logsPerSecond: z.number(),
      }),
    )
    .ensureTypeMatchesSchema();
}
