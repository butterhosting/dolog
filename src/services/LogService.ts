import { LogError } from "@/errors/LogError";
import { ServerError } from "@/errors/ServerError";
import { Uuid } from "@/models/Uuid";
import { ZodProblem } from "@/helpers/ZodIssues";
import { ZodParser } from "@/helpers/ZodParser";
import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Filter } from "@/models/Filter";
import { Anchor } from "@/models/Anchor";
import { Pattern } from "@/models/Pattern";
import { EventRepository } from "@/repositories/EventRepository";
import { SocketService } from "@/services/SocketService";
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

  public async list(containerId: string, unknown: unknown): Promise<EventRepository.ListResult> {
    const listQuery = this.parseAndValidateListQuery(unknown);

    if (listQuery.at && listQuery.cursor) {
      throw LogError.conflicting_position({
        at: listQuery.at.value.toString(),
        cursor: listQuery.cursor,
      });
    }

    // cursor-based listing
    if (listQuery.cursor) {
      return await this.eventRepository.listEvents(containerId, listQuery.limit, listQuery.cursor, listQuery.filter);
    }
    // anchor-based listing (a window around the anchor)
    if (listQuery.at) {
      return await this.listAround(containerId, listQuery.at, listQuery.limit, listQuery.filter);
    }
    // most recent listing (just get the latest logs)
    return await this.eventRepository.listEvents(containerId, listQuery.limit, {}, listQuery.filter);
  }

  private async listAround(containerId: string, anchor: Anchor, limit: number, filter: Filter): Promise<EventRepository.ListResult> {
    const anchorBoundary = anchor.type === "id" ? anchor.value : Uuid.fromBytes(Uuid.lowerBoundAt(anchor.value));

    const [before, after] = await Promise.all([
      this.eventRepository.listEvents(containerId, limit, { before: anchorBoundary, beforeInclusivity: "exclusive" }, filter),
      this.eventRepository.listEvents(
        containerId,
        limit,
        { after: anchorBoundary, afterInclusivity: anchor.type === "id" ? "inclusive" : "exclusive" },
        filter,
      ),
    ]);

    // half each, and whatever half the other side could not fill
    const half = Math.floor(limit / 2);
    const afterCount = Math.min(after.data.length, limit - Math.min(before.data.length, half));
    const beforeCount = Math.min(before.data.length, limit - afterCount);

    const hasNewer = after.data.length > afterCount || after.hasNewer;
    const hasOlder = before.data.length > beforeCount || before.hasOlder;
    return {
      data: [
        ...before.data.slice(before.data.length - beforeCount), //
        ...after.data.slice(0, afterCount),
      ],
      hasOlder,
      hasNewer,
    };
  }

  private parseAndValidateFindQuery(unknown: unknown) {
    return (
      LogService.FindQuery
        // validate anchor
        .refine(({ anchorInclusive, anchorExclusive }) => !(anchorInclusive && anchorExclusive), {
          error: "cannot specify both `inclusive` and `exclusive`",
        })
        .transform(({ searchPattern, searchPatternType, anchorInclusive, anchorExclusive, direction, ...fields }) => ({
          search: {
            pattern: {
              type: searchPatternType,
              value: searchPattern,
            },
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
          error: "cannot specify both `afterExclusive` and `afterInclusive`",
        })
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
}

export namespace LogService {
  export enum FilterKey {
    filterPattern = "filterPattern",
    filterPatternType = "filterPatternType",
    filterSince = "filterSince",
    filterUntil = "filterUntil",
  }

  export type FilterSubQuery = z.input<typeof FilterSubQuery>;
  const FilterSubQuery = z
    .object({
      [FilterKey.filterPattern]: z.string().optional(),
      [FilterKey.filterPatternType]: z.enum(Pattern.Type).optional(),
      [FilterKey.filterSince]: z.string().transform(ZodParser.instant).optional(),
      [FilterKey.filterUntil]: z.string().transform(ZodParser.instant).optional(),
    })
    .transform(({ filterPattern, filterPatternType, filterSince, filterUntil }): { filter: Filter } => ({
      filter: {
        pattern:
          filterPattern && filterPatternType
            ? {
                type: filterPatternType,
                value: filterPattern,
              }
            : undefined,
        since: filterSince,
        until: filterUntil,
      },
    }));

  export type FindQuery = z.input<typeof FindQuery>;
  export const FindQuery = z
    .object({
      searchPattern: z.string(),
      searchPatternType: z.enum(Pattern.Type),
      anchorInclusive: z.string().optional(),
      anchorExclusive: z.string().optional(),
      direction: z.enum(Direction),
    })
    .and(FilterSubQuery);

  export type FindResult = {
    id: string | undefined;
  };

  export type ListQuery = z.input<typeof ListQuery>;
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
      at: z
        .string()
        .transform((value, ctx): Anchor => {
          const anchor = Anchor.parse(value);
          if (!anchor) {
            ctx.addIssue({ code: "custom", message: "must be a line id (uuid) or an instant" });
            return z.NEVER;
          }
          return anchor;
        })
        .optional(),
    })
    .and(FilterSubQuery);

  export namespace ListResult {
    export const parse = ZodParser.forType<EventRepository.ListResult>()
      .ensureSchemaMatchesType(() =>
        z.object({
          data: z.array(ContainerEvent.parse.SCHEMA),
          hasOlder: z.boolean(),
          hasNewer: z.boolean(),
        }),
      )
      .ensureTypeMatchesSchema();
  }
}
