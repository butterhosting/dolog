import { LogPattern } from "@/models/LogPattern";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { ContainerRM } from "@/models/ContainerRM";
import { Yesttp } from "yesttp";
import type { LogService } from "@/services/LogService";
import type z from "zod/v4";

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
      reachesLiveFeed: boolean;
      landedOn?: string | null;
    }>(`/containers/${containerId}/logs`, {
      searchParams: Internal.listParams(options),
    });
    return {
      events: json.events.map(ContainerEvent.parse),
      hasOlder: json.hasOlder,
      hasNewer: json.hasNewer,
      reachesLiveFeed: json.reachesLiveFeed,
      landedOn: json.landedOn ?? null,
    };
  }

  public async find(containerId: string, options: ContainerClient.FindOptions): Promise<string | null> {
    const { json } = await this.yesttp.get<string | null>(`/containers/${containerId}/logs/find`, {
      searchParams: Internal.findParams(options),
    });
    return json;
  }
}

namespace Internal {
  /**
   * A query string is the one seam types do not cross on their own: it is strings by the time it
   * leaves, so a parameter renamed on the server arrives here as a field quietly dropped rather than
   * as a broken build -- the request still succeeds, having ignored what it was asked. Naming the
   * schemas' own input types below puts the compiler back in the middle of it.
   *
   * The import is type-only, so nothing of the server is carried into the bundle.
   */
  type ListParams = z.input<typeof LogService.ListQuery>;
  type FindParams = z.input<typeof LogService.FindQuery>;
  /**
   * Named through `Pick` rather than written out, because a spread is invisible to the excess
   * property check that guards the rest: these four would otherwise be the one part of the request
   * that could still drift silently. Renaming any of them on the server fails here, on the key.
   */
  type FilterParams = Pick<ListParams, "filterPattern" | "filterPatternVariant" | "filterSince" | "filterUntil">;

  /**
   * Nested where it is read, flat where it is reported.
   *
   * Grouping the window terms keeps a call site legible -- it is obvious which half addresses the
   * endpoint and which half describes what to look at. The wire stays flat and prefixed because the
   * server reports rejections by parameter path, so a nested shape would have a 400 describing our
   * object graph rather than the request that was actually sent.
   */
  function filterParams(filter?: ContainerClient.Filter): FilterParams {
    return {
      filterPattern: filter?.pattern,
      // meaningless without something to read, and sending it alone would look like a filter
      filterPatternVariant: filter?.pattern ? filter.variant : undefined,
      filterSince: filter?.since,
      filterUntil: filter?.until,
    };
  }

  // every wire name is written out rather than spread, so each one is checked against the schema
  export function listParams(options: ContainerClient.LogsOptions): ListParams {
    return {
      limit: options.limit,
      beforeExclusive: options.beforeExclusive,
      afterExclusive: options.afterExclusive,
      afterInclusive: options.afterInclusive,
      at: options.at,
      ...filterParams(options.filter),
    };
  }

  export function findParams(options: ContainerClient.FindOptions): FindParams {
    return {
      // the needle is prefixed on the wire, so a rejection names which of the two patterns it means
      searchPattern: options.pattern,
      searchPatternVariant: options.patternVariant,
      anchorInclusive: options.anchorInclusive,
      anchorExclusive: options.anchorExclusive,
      direction: options.direction,
      ...filterParams(options.filter),
    };
  }
}

export namespace ContainerClient {
  export type FindOptions = {
    pattern: string;
    patternVariant: LogPattern.Variant;
    /** Anchored on an ordinary line the reader was looking at, which may itself match. */
    anchorInclusive?: string;
    /** Stepping off a match already found -- including it would return that same line forever. */
    anchorExclusive?: string;
    direction: Direction;
    /** The corpus this search happens inside, so it never lands on a line the view hides. */
    filter?: ContainerClient.Filter;
  };

  export type LogsOptions = {
    limit?: number;
    /** Ids of events already held: `beforeExclusive` reads backwards, `after*` forwards, neither is the live end. */
    beforeExclusive?: string;
    afterExclusive?: string;
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
    variant?: LogPattern.Variant;
    since?: string;
    until?: string;
  };

  export type Page = {
    events: ContainerEvent[];
    hasOlder: boolean;
    /** More of this window below the page. Not a claim about the feed -- see `reachesLiveFeed`. */
    hasNewer: boolean;
    /** Whether the bottom of this window is the feed itself, so a streamed line belongs beneath it. */
    reachesLiveFeed: boolean;
    /**
     * Where an `at` request settled: the id of the line it landed on, or null when the instant was
     * past everything logged and the end of history was served instead. Null too when no instant was
     * asked for, which the caller tells apart by knowing whether it asked.
     */
    landedOn: string | null;
  };
}
