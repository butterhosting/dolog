import { LineMatch } from "@/helpers/LineMatch";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerRM } from "@/models/ContainerRM";
import { Yesttp } from "yesttp";

export class ContainerClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async list(): Promise<ContainerRM[]> {
    const { json } = await this.yesttp.get<unknown[]>("/containers");
    return json.map(ContainerRM.parse);
  }

  public async logs(
    containerId: string,
    { limit, before, after, from, at, ...filter }: ContainerClient.LogsOptions = {},
  ): Promise<ContainerClient.Page> {
    const parameters = new URLSearchParams();
    Object.entries({ limit, before, after, from, at, ...filter }).forEach(([key, value]) => {
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

  /**
   * The nearest line matching `find` in the given direction, or null when there is none that way.
   *
   * Only a position comes back. Most answers are lines already on screen, so asking for a page here
   * would throw away the window the reader is holding in order to be handed most of it again.
   */
  public async find(containerId: string, options: ContainerClient.FindOptions): Promise<string | null> {
    const parameters = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        parameters.set(key, `${value}`);
      }
    });
    const { json } = await this.yesttp.get<{ landedOn: string | null }>(`/containers/${containerId}/logs/find?${parameters}`);
    return json.landedOn;
  }
}

export namespace ContainerClient {
  export type FindOptions = {
    find: string;
    variant: LineMatch.Variant;
    /** The line to search out from; absent starts at whichever end `direction` reads from. */
    from?: string;
    /** Whether `from` may itself be the answer -- false when stepping off a match already found. */
    inclusive: boolean;
    direction: "up" | "down";
  } & ContainerClient.FilterOptions;

  export type LogsOptions = {
    limit?: number;
    /** Ids of events already held: `before` reads backwards, `after` forwards, neither is the live end. */
    before?: string;
    after?: string;
    /** Like `after`, but opening the window *with* that line rather than just past it. */
    from?: string;
    /** A wall-clock instant to read forwards from, for arriving somewhere by time rather than by id. */
    at?: string;
  } & ContainerClient.FilterOptions;

  /**
   * The narrowed view a request applies inside. Prefixed because search carries a pattern and a
   * variant of its own, and one request can carry both.
   */
  export type FilterOptions = {
    filterPattern?: string;
    filterVariant?: LineMatch.Variant;
    filterSince?: string;
    filterUntil?: string;
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
