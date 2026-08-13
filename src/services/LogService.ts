import { LogError } from "@/errors/LogError";
import { ServerError } from "@/errors/ServerError";
import { Uuid } from "@/helpers/Uuid";
import { ZodProblem } from "@/helpers/ZodIssues";
import { ZodParser } from "@/helpers/ZodParser";
import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { LogPattern } from "@/models/LogPattern";
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

  public async find(containerId: string, unknown: unknown): Promise<LogService.FindResult> {
    const findQuery = this.parseAndValidateFindQuery(unknown);
    return await this.eventRepository.findEvent(containerId, findQuery.search, findQuery.filter);
  }

  public async list(containerId: string, unknown: unknown): Promise<LogService.ListResult> {
    const listQuery = this.parseAndValidateListQuery(unknown);

    if (listQuery.at && listQuery.cursor) {
      throw LogError.conflicting_position({
        at: listQuery.at.toString(),
        cursor: listQuery.cursor,
      });
    }

    // cursor-based listing
    if (listQuery.cursor) {
      return await this.eventRepository.listEvents(containerId, listQuery.limit, listQuery.cursor, listQuery.filter);
    }
    // boundary-based listing (around a specific `at`-anchor in a specific directions)
    if (listQuery.at) {
      const boundary = Uuid.fromBytes(Uuid.lowerBoundAt(listQuery.at));
      const forwards = await this.eventRepository.listEvents(
        containerId,
        listQuery.limit,
        { after: boundary, afterInclusivity: "exclusive" },
        listQuery.filter,
      );
      if (forwards.data.length > 0) {
        return {
          ...forwards,
          landedOn: forwards.data[0].id,
        };
      }
      const backwards = await this.eventRepository.listEvents(
        containerId,
        listQuery.limit,
        { before: boundary, beforeInclusivity: "exclusive" },
        listQuery.filter,
      );
      return {
        ...backwards,
        hasNewer: false,
        reachesLiveFeed: this.eventRepository.reachesLiveFeed({ hasNewer: false, filter: listQuery.filter }),
        landedOn: undefined, // indicates that we couldn't find any logs past the provided `at`-boundary
      };
    }
    // most recent listing (get the latest logs, without anything to anchor)
    return await this.eventRepository.listEvents(containerId, listQuery.limit, {}, listQuery.filter);
  }

  private parseAndValidateFindQuery(unknown: unknown) {
    return (
      LogService.FindQuery
        // validate anchor
        .refine(({ anchorInclusive, anchorExclusive }) => !(anchorInclusive && anchorExclusive), {
          error: "cannot specify both `inclusive` and `exclusive`",
        })
        .transform(this.filterTransform)
        .transform(({ searchPattern, searchPatternVariant, anchorInclusive, anchorExclusive, direction, ...fields }) => ({
          search: {
            logPattern: { pattern: searchPattern, patternVariant: searchPatternVariant },
            anchorId: anchorInclusive ?? anchorExclusive,
            anchorInclusivity: anchorInclusive !== undefined ? "inclusive" : anchorExclusive !== undefined ? "exclusive" : undefined,
            direction,
          } satisfies EventRepository.Search,
          ...fields,
        }))
        .catch((e) => {
          throw ServerError.invalid_request_query(ZodProblem.issuesSummary(e));
        })
        .parse(unknown)
    );
  }

  private parseAndValidateListQuery(unknown: unknown) {
    return (
      LogService.ListQuery
        // validate provided range
        .refine(({ afterExclusive, afterInclusive }) => !(afterExclusive !== undefined && afterInclusive !== undefined), {
          error: "cannot specify both `after` and `afterInclusive`",
        })
        .transform(this.filterTransform)
        .transform(({ beforeExclusive, afterInclusive, afterExclusive, ...fields }) => ({
          cursor:
            (beforeExclusive ?? afterInclusive ?? afterExclusive)
              ? ({
                  before: beforeExclusive,
                  beforeInclusivity: "exclusive",
                  after: afterInclusive ?? afterExclusive,
                  afterInclusivity: afterInclusive !== undefined ? "inclusive" : afterExclusive !== undefined ? "exclusive" : undefined,
                } satisfies EventRepository.Cursor)
              : undefined,
          ...fields,
        }))
        .catch((e) => {
          throw ServerError.invalid_request_query(ZodProblem.issuesSummary(e));
        })
        .parse(unknown)
    );
  }

  private filterTransform<
    T extends {
      filterPattern?: string;
      filterPatternVariant?: LogPattern.Variant;
      filterSince?: Temporal.Instant;
      filterUntil?: Temporal.Instant;
    },
  >(
    query: T,
  ): Omit<T, "filterPattern" | "filterPatternVariant" | "filterSince" | "filterUntil"> & {
    filter: EventRepository.Filter;
  } {
    const { filterPattern, filterPatternVariant, filterSince, filterUntil, ...fields } = query;
    return {
      ...fields,
      filter: {
        logPattern:
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
  }
}

export namespace LogService {
  export enum FilterKey {
    filterPattern = "filterPattern",
    filterPatternVariant = "filterPatternVariant",
    filterSince = "filterSince",
    filterUntil = "filterUntil",
  }
  export type FilterSubQuery = z.infer<typeof FilterSubQuery>;
  const FilterSubQuery = z.object({
    [FilterKey.filterPattern]: z.string().optional(),
    [FilterKey.filterPatternVariant]: z.enum(LogPattern.Variant).optional(),
    [FilterKey.filterSince]: z.string().transform(ZodParser.instant).optional(),
    [FilterKey.filterUntil]: z.string().transform(ZodParser.instant).optional(),
  });

  export type FindQuery = z.infer<typeof FindQuery>;
  export const FindQuery = z
    .object({
      searchPattern: z.string(),
      searchPatternVariant: z.enum(LogPattern.Variant),
      anchorInclusive: z.string().optional(),
      anchorExclusive: z.string().optional(),
      direction: z.enum(Direction),
    })
    .and(FilterSubQuery);

  export type FindResult = {
    id: string | undefined;
  };

  export type ListQuery = z.infer<typeof ListQuery>;
  export const ListQuery = z
    .object({
      beforeExclusive: z.string().optional(),
      afterExclusive: z.string().optional(),
      afterInclusive: z.string().optional(),
      limit: z.coerce
        .number()
        .int()
        .positive()
        .default(100) // = default number of events per page
        .transform((requested) => Math.min(requested, 500)), // = maximum number of events per page
      at: z.string().transform(ZodParser.instant).optional(),
    })
    .and(FilterSubQuery);

  export type ListResult = EventRepository.ListResult & {
    landedOn?: string;
  };
  export namespace ListResult {
    export const parse = ZodParser.forType<ListResult>()
      .ensureSchemaMatchesType(() =>
        z.object({
          data: z.array(ContainerEvent.parse.SCHEMA),
          hasOlder: z.boolean(),
          hasNewer: z.boolean(),
          reachesLiveFeed: z.boolean(),
          landedOn: z.string().optional(),
        }),
      )
      .ensureTypeMatchesSchema();
  }
}
