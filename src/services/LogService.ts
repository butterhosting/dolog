import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { LineMatch } from "@/helpers/LineMatch";
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

  public async list(containerId: string, query: z.output<typeof LogService.Query>): Promise<LogService.Page> {
    query = LogService.Query.parse(query);

    let at: Temporal.Instant | undefined;
    let cursor: EventRepository.Cursor | undefined;
    const limit = query.limit;
    const filter: EventRepository.Filter = LogService.filter(query);

    if (query.at) {
      at = query.at;
    }
    if (query.before !== undefined || query.after !== undefined || query.afterInclusive !== undefined) {
      cursor = { before: query.before, after: query.after, afterInclusive: query.afterInclusive };
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
        // naming the line it settled on saves the caller re-deriving it from the timestamps, which it
        // cannot do exactly: the boundary is a millisecond, and an instant may sit inside one
        return {
          ...forwards,
          landedOn: forwards.events[0].id,
        };
      }
      /**
       * Nothing was logged at or after that instant -- a date typed past the end of the logs, usually.
       * Reading back from it lands the reader at the end of history rather than on an empty screen,
       * and nothing is newer than that by definition.
       *
       * This answer used to be indistinguishable from an ordinary landing, so a caller could not tell
       * that it had been given something other than what it asked for. `landedOn: null` says so.
       */
      const backwards = await this.eventRepository.listEvents(containerId, limit, { before: boundary }, filter);
      return { ...backwards, hasNewer: false, landedOn: null };
    }

    throw new Error("unreachable");
  }

  public async find(containerId: string, query: z.output<typeof LogService.Find>): Promise<string | null> {
    query = LogService.Find.parse(query);
    if (query.anchorInclusive !== undefined && query.anchorExclusive !== undefined) {
      throw LogError.conflicting_search_anchor({ anchorInclusive: query.anchorInclusive, anchorExclusive: query.anchorExclusive });
    }

    const search: EventRepository.Search = {
      pattern: query.pattern,
      patternVariant: query.patternVariant,
      anchorInclusive: query.anchorInclusive,
      anchorExclusive: query.anchorExclusive,
      direction: query.direction,
    };
    const filter: EventRepository.Filter = LogService.filter(query);
    return await this.eventRepository.findEvent(containerId, search, filter);
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
    filterVariant: z.enum(["substr", "regex"] satisfies LineMatch.Variant[]).default("substr"),
    filterSince: z.string().transform(ZodParser.instant).optional(),
    filterUntil: z.string().transform(ZodParser.instant).optional(),
  };

  export const Query = z
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
    .catch((e) => {
      throw ServerError.invalid_request_query(ZodProblem.issuesSummary(e));
    });

  export const Find = z
    .object({
      pattern: z.string().min(1),
      patternVariant: z.enum(["substr", "regex"] satisfies LineMatch.Variant[]).default("substr"),
      anchorInclusive: z.string().optional(),
      anchorExclusive: z.string().optional(),
      direction: z.enum(["up", "down"]).default("down"),
      ...FILTER,
    })
    .catch((e) => {
      throw ServerError.invalid_request_query(ZodProblem.issuesSummary(e));
    });

  export function filter(query: {
    filterPattern?: string;
    filterVariant: LineMatch.Variant;
    filterSince?: Temporal.Instant;
    filterUntil?: Temporal.Instant;
  }): EventRepository.Filter {
    return {
      matcher: query.filterPattern ? { pattern: query.filterPattern, variant: query.filterVariant } : undefined,
      since: query.filterSince,
      until: query.filterUntil,
    };
  }
}
