import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerRM } from "@/models/ContainerRM";
import { Yesttp } from "yesttp";

export class ContainerClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async overview(): Promise<ContainerRM[]> {
    const { json } = await this.yesttp.get<unknown[]>("/containers");
    return json.map(ContainerRM.parse);
  }

  /**
   * A page of history, oldest first. `before` is the cursor from a previous page, for walking
   * further back as the viewer scrolls up.
   */
  public async events(containerId: string, before?: number): Promise<ContainerClient.Page> {
    const query = before === undefined ? "" : `?before=${before}`;
    const { json } = await this.yesttp.get<{ events: unknown[]; olderCursor: number | null }>(`/containers/${containerId}/events${query}`);
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
