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
    private readonly logRepository: EventRepository,
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

  public async list(containerId: string, unknown: z.output<typeof LogService.Query>): Promise<LogService.Page> {
    const query = LogService.Query.parse(unknown);
    const { limit, before, after, from, at } = query;
    const filter = LogService.filter(query);
    /**
     * `at` names a position on its own, so pairing it with a cursor asks for two starting points at
     * once. It used to win silently and the cursor was dropped, which reads as the server ignoring
     * half the request -- worth refusing rather than guessing which half was meant.
     *
     * Named here rather than refined in the schema because the schema reports issues by *code*, and
     * a cross-field rule only ever has "custom" to offer -- which tells the caller nothing.
     */
    if (at !== undefined && (before !== undefined || after !== undefined || from !== undefined)) {
      throw LogError.conflicting_position({
        at: at.toString(),
        before: before ?? null,
        after: after ?? null,
        from: from ?? null,
      });
    }
    if (!at) {
      return await this.logRepository.listEvents(containerId, limit, { before, after, from }, filter);
    }
    const boundary = Uuid.fromBytes(Uuid.lowerBoundAt(at));
    const forwards = await this.logRepository.listEvents(containerId, limit, { after: boundary }, filter);
    if (forwards.events.length > 0) {
      // naming the line it settled on saves the caller re-deriving it from the timestamps, which it
      // cannot do exactly: the boundary is a millisecond, and an instant may sit inside one
      return { ...forwards, landedOn: forwards.events[0]!.id };
    }
    /**
     * Nothing was logged at or after that instant -- a date typed past the end of the logs, usually.
     * Reading back from it lands the reader at the end of history rather than on an empty screen,
     * and nothing is newer than that by definition.
     *
     * This answer used to be indistinguishable from an ordinary landing, so a caller could not tell
     * that it had been given something other than what it asked for. `landedOn: null` says so.
     */
    const backwards = await this.logRepository.listEvents(containerId, limit, { before: boundary }, filter);
    return { ...backwards, hasNewer: false, landedOn: null };
  }

  /**
   * Where the next line matching a needle sits, without moving anything. The caller decides what to
   * do with the answer: scroll to it if it already has it, fetch a window around it if it does not.
   */
  public async find(containerId: string, unknown: z.output<typeof LogService.Find>): Promise<{ landedOn: string | null }> {
    const query = LogService.Find.parse(unknown);
    const { find, variant, from, inclusive, direction } = query;
    try {
      const search = { needle: find, variant, from, inclusive, direction };
      // the filter defines the corpus, so search walks inside it rather than across the whole log
      return { landedOn: await this.logRepository.findEvent(containerId, search, LogService.filter(query)) };
    } catch (error) {
      // a half-typed regular expression is an ordinary thing to receive, not a fault
      if (error instanceof SyntaxError) {
        throw LogError.invalid_search_pattern({ pattern: find, reason: error.message });
      }
      throw error;
    }
  }
}

export namespace LogService {
  /** Upper bound on one request, so a caller cannot make us build an enormous page. */
  const MAX_EVENTS_PER_PAGE = 500;
  /** What a caller that expresses no preference gets: a screenful or two, not the largest page we serve. */
  const DEFAULT_EVENTS_PER_PAGE = 100;

  /**
   * Flat and prefixed rather than nested, so a rejection names the parameter the caller sent --
   * `ZodProblem.issuesSummary` reports issues by path, and a reshaped one would describe our object
   * graph instead of their request. The pieces are assembled into a `Filter` after parsing.
   */
  const FILTER = {
    filterPattern: z.string().optional(),
    filterVariant: z.enum(["substr", "regex"] satisfies LineMatch.Variant[]).default("substr"),
    filterSince: z.string().transform(ZodParser.instant).optional(),
    filterUntil: z.string().transform(ZodParser.instant).optional(),
  };

  export type Page = EventRepository.Page & {
    /**
     * Where an `at` request settled: the id of the first line at or after the instant, or null when
     * there was none and the end of history was served instead. Absent when no instant was asked for.
     */
    landedOn?: string | null;
  };

  export const Find = z
    .object({
      find: z.string().min(1),
      // an enum rather than `regex=true`, so a third way of reading a needle costs a value, not a flag
      variant: z.enum(["substr", "regex"] satisfies LineMatch.Variant[]).default("substr"),
      from: z.string().optional(),
      inclusive: z
        .string()
        .optional()
        .transform((value) => value === "true"),
      direction: z.enum(["up", "down"]).default("down"),
      ...FILTER,
    })
    .catch((e) => {
      throw ServerError.invalid_request_query(ZodProblem.issuesSummary(e));
    });

  export const Query = z
    .object({
      // clamped rather than rejected: the caller knows how many will still fit on its screen, and
      // asking for more than we serve is not a mistake worth failing their request over
      limit: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_EVENTS_PER_PAGE)
        .transform((requested) => Math.min(requested, MAX_EVENTS_PER_PAGE)),
      before: z.string().optional(),
      after: z.string().optional(),
      from: z.string().optional(),
      at: z.string().transform(ZodParser.instant).optional(),
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
