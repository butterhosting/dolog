import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { Temporal } from "@js-temporal/polyfill";
import { Container } from "@/models/Container";
import { ContainerRM } from "@/models/ContainerRM";
import { Throughput } from "@/models/Throughput";
import { EventRepository } from "@/repositories/EventRepository";
import { SocketService } from "@/socket/SocketService";
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
    const [running, recorded, throughputs] = await Promise.all([
      this.dockerSocket.listRunningContainers().catch(() => [] as Container[]),
      this.eventRepository.listContainers(),
      firstValueFrom(this.throughputs),
    ]);
    const rate = new Map(throughputs.map((throughput) => [throughput.container.id, throughput]));
    const seen = new Map(recorded.map(({ container, lastSeen }) => [container.id, lastSeen]));
    const merged = new Map(running.map((container) => [container.id, container]));
    recorded.forEach(({ container }) => merged.set(container.id, merged.get(container.id) ?? container));

    return [...merged.values()]
      .map((container): ContainerRM => ({
        ...container,
        running: running.some((candidate) => candidate.id === container.id),
        lastSeen: seen.get(container.id) ?? null,
        logsPerSecond: rate.get(container.id)?.logsPerSecond ?? 0,
        throttling: rate.get(container.id)?.throttling ?? false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
}
