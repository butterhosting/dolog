export type Service = {
  id: string;
  dname: string;
  dgroup?: string;
};

export namespace Service {
  export function id({ dname, dgroup }: Pick<Service, "dname" | "dgroup">): string {
    const marker = dgroup ? "1" : "0";
    const len = dname.length.toString().padStart(3, "0"); // dname ≤ 999 chars
    return `${marker}${len}${dname}${dgroup ?? ""}`;
  }

  export function fromId(id: string): Service {
    const hasGroup = id[0] === "1";
    const len = Number(id.slice(1, 4));
    const dname = id.slice(4, 4 + len);
    const dgroup = hasGroup ? id.slice(4 + len) : undefined;
    return {
      id,
      dname,
      dgroup,
    };
  }
}
