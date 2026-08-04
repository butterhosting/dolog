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

  public async list(containerId: string, unknown: z.output<typeof LogService.Query>): Promise<EventRepository.Page> {
    const { limit, before, after, at } = LogService.Query.parse(unknown);
    if (!at) {
      return await this.logRepository.listEvents(containerId, limit, { before, after });
    }
    const boundary = Uuid.fromBytes(Uuid.lowerBoundAt(at));
    const forwards = await this.logRepository.listEvents(containerId, limit, { after: boundary });
    if (forwards.events.length > 0) {
      return forwards;
    }
    /**
     * Nothing was logged at or after that instant -- a date typed past the end of the logs, usually.
     * Reading back from it lands the reader at the end of history rather than on an empty screen,
     * and nothing is newer than that by definition.
     */
    const backwards = await this.logRepository.listEvents(containerId, limit, { before: boundary });
    return { ...backwards, hasNewer: false };
  }
}

export namespace LogService {
  /** Upper bound on one request, so a caller cannot make us build an enormous page. */
  const MAX_EVENTS_PER_PAGE = 500;

  export const Query = z
    .object({
      // clamped rather than rejected: the caller knows how many will still fit on its screen, and
      // asking for more than we serve is not a mistake worth failing their request over
      limit: z.coerce
        .number()
        .int()
        .positive()
        .default(MAX_EVENTS_PER_PAGE)
        .transform((requested) => Math.min(requested, MAX_EVENTS_PER_PAGE)),
      before: z.string().optional(),
      after: z.string().optional(),
      at: z.string().transform(ZodParser.instant).optional(),
    })
    .catch((e) => {
      throw ServerError.invalid_request_query(ZodProblem.issuesSummary(e));
    });
}
