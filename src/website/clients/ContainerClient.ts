import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerRM } from "@/models/ContainerRM";
import { Yesttp } from "yesttp";

export class ContainerClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async list(): Promise<ContainerRM[]> {
    const { json } = await this.yesttp.get<unknown[]>("/containers");
    return json.map(ContainerRM.parse);
  }

  public async logs(containerId: string, { limit, before, after, at }: ContainerClient.LogsOptions = {}): Promise<ContainerClient.Page> {
    const parameters = new URLSearchParams();
    Object.entries({ limit, before, after, at }).forEach(([key, value]) => {
      if (value !== undefined) {
        parameters.set(key, `${value}`);
      }
    });
    const query = parameters.size === 0 ? "" : `?${parameters}`;
    const { json } = await this.yesttp.get<{ events: unknown[]; hasOlder: boolean; hasNewer: boolean }>(
      `/containers/${containerId}/logs${query}`,
    );
    return {
      events: json.events.map(ContainerEvent.parse),
      hasOlder: json.hasOlder,
      hasNewer: json.hasNewer,
    };
  }
}

export namespace ContainerClient {
  export type LogsOptions = {
    limit?: number;
    /** Ids of events already held: `before` reads backwards, `after` forwards, neither is the live end. */
    before?: string;
    after?: string;
    /** A wall-clock instant to read forwards from, for arriving somewhere by time rather than by id. */
    at?: string;
  };

  export type Page = {
    events: ContainerEvent[];
    hasOlder: boolean;
    /** False once the window reaches the live feed, so there is nothing further down to fetch. */
    hasNewer: boolean;
  };
}
