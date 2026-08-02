import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerRM } from "@/models/ContainerRM";
import { Yesttp } from "yesttp";

export class ContainerClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async list(): Promise<ContainerRM[]> {
    const { json } = await this.yesttp.get<unknown[]>("/containers");
    return json.map(ContainerRM.parse);
  }

  public async logs(containerId: string, before?: number): Promise<ContainerClient.Page> {
    const query = before === undefined ? "" : `?before=${before}`;
    const { json } = await this.yesttp.get<{ events: unknown[]; olderCursor: number | null }>(`/containers/${containerId}/logs${query}`);
    return {
      events: json.events.map(ContainerEvent.parse),
      olderCursor: json.olderCursor,
    };
  }
}

export namespace ContainerClient {
  export type Page = {
    events: ContainerEvent[];
    olderCursor: number | null;
  };
}
