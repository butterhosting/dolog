import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { Temporal } from "@js-temporal/polyfill";
import { Container } from "@/models/Container";
import { ContainerRM } from "@/models/ContainerRM";
import { Throughput } from "@/models/Throughput";
import { EventRepository } from "@/repositories/EventRepository";
import { SocketService } from "@/services/SocketService";
import { auditTime, catchError, concatMap, defer, EMPTY, filter, firstValueFrom, merge, Observable } from "rxjs";
import { DockerSocket } from "./streaming/DockerSocket";
import { Fountain } from "./streaming/Fountain";

export class ContainerService {
  private readonly log = new Logger(__filename);
  private readonly throughputs: Observable<Throughput[]>;
  private readonly containers: Observable<Container[]>;

  public constructor(
    fountain: Fountain,
    private readonly dockerSocket: DockerSocket,
    private readonly eventRepository: EventRepository,
    private readonly socketService: SocketService,
  ) {
    this.throughputs = fountain.streamThroughputs();
    this.containers = eventRepository.streamContainers();
  }

  @Initialize
  public broadcastOverviewAsItChanges() {
    const BROADCAST_INTERVAL = Temporal.Duration.from({ seconds: 1 });

    merge(this.containers, this.throughputs)
      .pipe(
        auditTime(BROADCAST_INTERVAL.total("milliseconds")),
        filter(() => this.socketService.hasConnections()),
        concatMap(() =>
          defer(() => this.list()).pipe(
            catchError((error) => {
              this.log.error("Could not build the container overview", error);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe({
        next: (containers) => this.socketService.broadcastContainers(containers),
        error: (error) => this.log.error("Stopped pushing container updates", error),
      });
  }

  public async list(): Promise<ContainerRM[]> {
    const [databaseContainers, runningContainers, throughputsPerContainer] = await Promise.all([
      this.eventRepository.listContainers(),
      this.dockerSocket.listRunningContainers().catch(() => [] as Container[]),
      firstValueFrom(this.throughputs),
    ]);
    return databaseContainers
      .map(({ container, firstSeen, lastSeen }): ContainerRM => {
        const running = runningContainers.some(({ id }) => id === container.id);
        const { throttling, logsPerSecond } = throughputsPerContainer.filter(({ container: { id } }) => id === container.id).at(0) || {
          throttling: false,
          logsPerSecond: 0,
        };
        return {
          ...container,
          firstSeen,
          lastSeen,
          running,
          throttling,
          logsPerSecond,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
}
