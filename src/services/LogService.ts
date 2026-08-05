import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ServerError } from "@/errors/ServerError";
import { Uuid } from "@/helpers/Uuid";
import { ZodProblem } from "@/helpers/ZodIssues";
import { ZodParser } from "@/helpers/ZodParser";
import { ContainerEvent } from "@/models/ContainerEvent";
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
    const { limit, before, after, at } = LogService.Query.parse(unknown);
    /**
     * `at` names a position on its own, so pairing it with a cursor asks for two starting points at
     * once. It used to win silently and the cursor was dropped, which reads as the server ignoring
     * half the request -- worth refusing rather than guessing which half was meant.
     *
     * Named here rather than refined in the schema because the schema reports issues by *code*, and
     * a cross-field rule only ever has "custom" to offer -- which tells the caller nothing.
     */
    if (at !== undefined && (before !== undefined || after !== undefined)) {
      throw ServerError.conflicting_log_position({ at: at.toString(), before: before ?? null, after: after ?? null });
    }
    if (!at) {
      return await this.logRepository.listEvents(containerId, limit, { before, after });
    }
    const boundary = Uuid.fromBytes(Uuid.lowerBoundAt(at));
    const forwards = await this.logRepository.listEvents(containerId, limit, { after: boundary });
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
    const backwards = await this.logRepository.listEvents(containerId, limit, { before: boundary });
    return { ...backwards, hasNewer: false, landedOn: null };
  }
}

export namespace LogService {
  /** Upper bound on one request, so a caller cannot make us build an enormous page. */
  const MAX_EVENTS_PER_PAGE = 500;
  /** What a caller that expresses no preference gets: a screenful or two, not the largest page we serve. */
  const DEFAULT_EVENTS_PER_PAGE = 100;

  export type Page = EventRepository.Page & {
    /**
     * Where an `at` request settled: the id of the first line at or after the instant, or null when
     * there was none and the end of history was served instead. Absent when no instant was asked for.
     */
    landedOn?: string | null;
  };

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
      at: z.string().transform(ZodParser.instant).optional(),
    })
    .catch((e) => {
      throw ServerError.invalid_request_query(ZodProblem.issuesSummary(e));
    });
}
