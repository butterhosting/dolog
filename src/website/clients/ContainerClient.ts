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
    const { json } = await this.yesttp.get<{
      events: unknown[];
      hasOlder: boolean;
      hasNewer: boolean;
      landedOn?: string | null;
    }>(`/containers/${containerId}/logs${query}`);
    return {
      events: json.events.map(ContainerEvent.parse),
      hasOlder: json.hasOlder,
      hasNewer: json.hasNewer,
      landedOn: json.landedOn ?? null,
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
    /**
     * Where an `at` request settled: the id of the line it landed on, or null when the instant was
     * past everything logged and the end of history was served instead. Null too when no instant was
     * asked for, which the caller tells apart by knowing whether it asked.
     */
    landedOn: string | null;
  };
}
