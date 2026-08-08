import { LogLinePattern } from "@/models/LogLinePattern";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerRM } from "@/models/ContainerRM";
import { Yesttp } from "yesttp";

export class ContainerClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async list(): Promise<ContainerRM[]> {
    const { json } = await this.yesttp.get<unknown[]>("/containers");
    return json.map(ContainerRM.parse);
  }

  public async logs(containerId: string, options: ContainerClient.LogsOptions = {}): Promise<ContainerClient.Page> {
    const { json } = await this.yesttp.get<{
      events: unknown[];
      hasOlder: boolean;
      hasNewer: boolean;
      landedOn?: string | null;
    }>(`/containers/${containerId}/logs`, {
      searchParams: Internal.searchParams(options),
    });
    return {
      events: json.events.map(ContainerEvent.parse),
      hasOlder: json.hasOlder,
      hasNewer: json.hasNewer,
      landedOn: json.landedOn ?? null,
    };
  }

  public async find(containerId: string, options: ContainerClient.FindOptions): Promise<string | null> {
    const { json } = await this.yesttp.get<string | null>(`/containers/${containerId}/logs/find`, {
      searchParams: Internal.searchParams(options),
    });
    return json;
  }
}

namespace Internal {
  /**
   * Nested where it is read, flat where it is reported.
   *
   * Grouping the window terms keeps a call site legible -- it is obvious which half addresses the
   * endpoint and which half describes what to look at. The wire stays flat and prefixed because the
   * server reports rejections by parameter path, so a nested shape would have a 400 describing our
   * object graph rather than the request that was actually sent.
   */
  export function searchParams({ filter, ...rest }: { filter?: ContainerClient.Filter }): Record<string, unknown> {
    return {
      ...rest,
      filterPattern: filter?.pattern,
      // meaningless without something to read, and sending it alone would look like a filter
      filterVariant: filter?.pattern ? filter.variant : undefined,
      filterSince: filter?.since,
      filterUntil: filter?.until,
    };
  }
}

export namespace ContainerClient {
  export type FindOptions = {
    pattern: string;
    patternVariant: LogLinePattern.Variant;
    /** Anchored on an ordinary line the reader was looking at, which may itself match. */
    anchorInclusive?: string;
    /** Stepping off a match already found -- including it would return that same line forever. */
    anchorExclusive?: string;
    direction: "up" | "down";
    /** The corpus this search happens inside, so it never lands on a line the view hides. */
    filter?: ContainerClient.Filter;
  };

  export type LogsOptions = {
    limit?: number;
    /** Ids of events already held: `before` reads backwards, `after` forwards, neither is the live end. */
    before?: string;
    after?: string;
    /** Like `after`, but opening the window *with* that line rather than just past it. */
    afterInclusive?: string;
    /** A wall-clock instant to read forwards from, for arriving somewhere by time rather than by id. */
    at?: string;
    /** What the window *is*, as opposed to where in it this request starts. */
    filter?: ContainerClient.Filter;
  };

  /**
   * The narrowed view a request applies inside -- a pattern, a span, or both. Absent parts narrow
   * nothing, so an empty filter is the whole log.
   */
  export type Filter = {
    pattern?: string;
    variant?: LogLinePattern.Variant;
    since?: string;
    until?: string;
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
