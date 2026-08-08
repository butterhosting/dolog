import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { LogLinePattern } from "@/models/LogLinePattern";
import { LogError } from "@/errors/LogError";
import { ServerError } from "@/errors/ServerError";
import { Uuid } from "@/helpers/Uuid";
import { ZodProblem } from "@/helpers/ZodIssues";
import { ZodParser } from "@/helpers/ZodParser";
import { ContainerEvent } from "@/models/ContainerEvent";
import { EventRepository } from "@/repositories/EventRepository";
import { SocketService } from "@/services/SocketService";
import { Temporal } from "@js-temporal/polyfill";
import { Observable } from "rxjs";
import z from "zod/v4";
import { Fountain } from "./streaming/Fountain";

export class LogService {
  private readonly log = new Logger(__filename);
  private readonly events: Observable<ContainerEvent>;

  public constructor(
    fountain: Fountain,
    private readonly eventRepository: EventRepository,
    private readonly socketService: SocketService,
  ) {
    this.events = fountain.streamEvents();
  }

  @Initialize
  public broadcastEventStream() {
    this.events.subscribe({
      next: (event) => this.socketService.broadcastEventStream(event),
      error: (error) => this.log.error("Stopped pushing log events", error),
    });
  }

  public async list(containerId: string, listQuery: z.output<typeof LogService.ListQuery>): Promise<LogService.Page> {
    listQuery = LogService.ListQuery.parse(listQuery);

    let at: Temporal.Instant | undefined;
    let cursor: EventRepository.Cursor | undefined;
    const limit: number = listQuery.limit;
    const filter: EventRepository.Filter = listQuery.filter;

    if (listQuery.at) {
      at = listQuery.at;
    }
    if (listQuery.before !== undefined || listQuery.after !== undefined || listQuery.afterInclusive !== undefined) {
      cursor = { before: listQuery.before, after: listQuery.after, afterInclusive: listQuery.afterInclusive };
    }
    if (at && cursor) {
      throw LogError.conflicting_position({ at: at.toString(), cursor });
    }
    if (!at && !cursor) {
      throw LogError.conflicting_position({});
    }

    // cursor-based listing
    if (cursor) {
      return await this.eventRepository.listEvents(containerId, limit, cursor, filter);
    }
    // boundary-based listing (around a specific `at`-anchor in both directions)
    if (at) {
      const boundary = Uuid.fromBytes(Uuid.lowerBoundAt(at));
      const forwards = await this.eventRepository.listEvents(containerId, limit, { after: boundary }, filter);
      if (forwards.events.length > 0) {
        return {
          ...forwards,
          landedOn: forwards.events[0].id,
        };
      }
      const backwards = await this.eventRepository.listEvents(containerId, limit, { before: boundary }, filter);
      return {
        ...backwards,
        hasNewer: false,
        landedOn: null, // indicates that we couldn't find any logs past the provided `at`-boundary
      };
    }

    throw new Error("unreachable");
  }

  public async find(containerId: string, findQuery: z.output<typeof LogService.FindQuery>): Promise<string | null> {
    findQuery = LogService.FindQuery.parse(findQuery);
    return await this.eventRepository.findEvent(containerId, findQuery.search, findQuery.filter);
  }
}

export namespace LogService {
  export type Page = EventRepository.Page & {
    landedOn?: string | null;
  };

  const MAX_EVENTS_PER_PAGE = 500;
  const DEFAULT_EVENTS_PER_PAGE = 100;

  const FILTER = {
    filterPattern: z.string().optional(),
    filterPatternVariant: z.enum(LogLinePattern.Variant).optional(),
    filterSince: z.string().transform(ZodParser.instant).optional(),
    filterUntil: z.string().transform(ZodParser.instant).optional(),
  };
  const FILTER_TRANSFORM = <
    T extends {
      filterPattern?: string;
      filterPatternVariant?: LogLinePattern.Variant;
      filterSince?: Temporal.Instant;
      filterUntil?: Temporal.Instant;
    },
  >(
    query: T,
  ): Omit<T, "filterPattern" | "filterPatternVariant" | "filterSince" | "filterUntil"> & {
    filter: EventRepository.Filter;
  } => {
    const { filterPattern, filterPatternVariant, filterSince, filterUntil, ...fields } = query;
    return {
      ...fields,
      filter: {
        logLinePattern:
          filterPattern && filterPatternVariant
            ? {
                pattern: filterPattern,
                patternVariant: filterPatternVariant,
              }
            : undefined,
        since: filterSince,
        until: filterUntil,
      } satisfies EventRepository.Filter,
    };
  };

  export const ListQuery = z
    .object({
      limit: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_EVENTS_PER_PAGE)
        .transform((requested) => Math.min(requested, MAX_EVENTS_PER_PAGE)),
      before: z.string().optional(),
      after: z.string().optional(),
      afterInclusive: z.string().optional(),
      at: z.string().transform(ZodParser.instant).optional(),
      ...FILTER,
    })
    .transform(FILTER_TRANSFORM)
    .catch((e) => {
      throw ServerError.invalid_request_query(ZodProblem.issuesSummary(e));
    });

  export const FindQuery = z
    .object({
      searchPattern: z.string(),
      searchPatternVariant: z.enum(LogLinePattern.Variant),
      anchorInclusive: z.string().optional(),
      anchorExclusive: z.string().optional(),
      direction: z.enum(["up", "down"]),
      ...FILTER,
    })
    .refine(({ anchorInclusive, anchorExclusive }) => !(anchorInclusive && anchorExclusive), {
      error: "cannot specify both `inclusive` and `exclusive`",
    })
    .transform(FILTER_TRANSFORM)
    .transform(({ searchPattern, searchPatternVariant, anchorInclusive, anchorExclusive, direction, ...fields }) => ({
      search: {
        logLinePattern: { pattern: searchPattern, patternVariant: searchPatternVariant },
        anchorId: anchorInclusive ?? anchorExclusive,
        anchorInclusivity: anchorInclusive !== undefined ? "inclusive" : anchorExclusive !== undefined ? "exclusive" : undefined,
        direction,
      } satisfies EventRepository.Search,
      ...fields,
    }))
    .catch((e) => {
      throw ServerError.invalid_request_query(ZodProblem.issuesSummary(e));
    });
}
