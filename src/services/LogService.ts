import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { EventRepository } from "@/repositories/EventRepository";
import { SocketService } from "@/socket/SocketService";
import { Observable } from "rxjs";
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
  public pushLogsToWatchers() {
    this.events.subscribe({
      next: (event) => this.socketService.broadcastLog(event),
      error: (error) => this.log.error("Stopped pushing log events", error),
    });
  }

  public async list(containerId: string, limit: number, before?: string): Promise<EventRepository.Page> {
    return await this.logRepository.listEvents(containerId, limit, before);
  }
}
