import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerEventRepository } from "@/repositories/ContainerEventRepository";
import { SocketService } from "@/socket/SocketService";
import { Observable } from "rxjs";
import { Fountain } from "./streaming/Fountain";

export class LogService {
  private readonly log = new Logger(__filename);
  private readonly events: Observable<ContainerEvent>;
  private initialized = false;

  public constructor(
    fountain: Fountain,
    private readonly containerEventRepository: ContainerEventRepository,
    private readonly socketService: SocketService,
  ) {
    this.events = fountain.streamEvents();
  }

  public initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.events.subscribe({
      next: (event) => this.socketService.broadcastLog(event),
      error: (error) => this.log.error("Stopped pushing log events", error),
    });
  }

  public async list(containerId: string, limit: number, before?: number): Promise<ContainerEventRepository.Page> {
    return await this.containerEventRepository.listEvents(containerId, limit, before);
  }
}
