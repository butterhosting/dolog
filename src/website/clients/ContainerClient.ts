import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerRM } from "@/models/ContainerRM";
import { Yesttp } from "yesttp";

export class ContainerClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async list(): Promise<ContainerRM[]> {
    const { json } = await this.yesttp.get<unknown[]>("/containers");
    return json.map(ContainerRM.parse);
  }

  public async logs(containerId: string, { limit, before }: ContainerClient.LogsOptions = {}): Promise<ContainerClient.Page> {
    const parameters = new URLSearchParams();
    if (limit !== undefined) {
      parameters.set("limit", `${limit}`);
    }
    if (before !== undefined) {
      parameters.set("before", `${before}`);
    }
    const query = parameters.size === 0 ? "" : `?${parameters}`;
    const { json } = await this.yesttp.get<{ events: unknown[]; hasOlder: boolean }>(`/containers/${containerId}/logs${query}`);
    return {
      events: json.events.map(ContainerEvent.parse),
      hasOlder: json.hasOlder,
    };
  }
}

export namespace ContainerClient {
  export type LogsOptions = {
    limit?: number;
    before?: string;
  };

  export type Page = {
    events: ContainerEvent[];
    hasOlder: boolean;
  };
}
