import { Logger } from "@/Logger";
import { Container } from "@/models/Container";
import { ContainerRM } from "@/models/ContainerRM";
import { Throughput } from "@/models/Throughput";
import { ContainerEventRepository } from "@/repositories/ContainerEventRepository";
import { SocketService } from "@/socket/SocketService";
import { auditTime, catchError, concatMap, defer, EMPTY, filter, firstValueFrom, merge, Observable } from "rxjs";
import { DockerSocket } from "./streaming/DockerSocket";
import { Fountain } from "./streaming/Fountain";

export class ContainerService {
  private readonly log = new Logger(__filename);
  private readonly throughputs: Observable<Throughput[]>;
  private readonly containers: Observable<Container[]>;
  private initialized = false;

  public constructor(
    fountain: Fountain,
    private readonly dockerSocket: DockerSocket,
    private readonly containerEventRepository: ContainerEventRepository,
    private readonly socketService: SocketService,
  ) {
    this.throughputs = fountain.streamThroughputs();
    this.containers = containerEventRepository.streamContainers();
  }

  public initialize() {
    const BROADCAST_INTERVAL_MS = 1_000;

    if (this.initialized) {
      return;
    }
    this.initialized = true;

    merge(this.containers, this.throughputs)
      .pipe(
        auditTime(BROADCAST_INTERVAL_MS),
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
      this.containerEventRepository.listOverview(),
      firstValueFrom(this.throughputs),
    ]);
    const rate = new Map(throughputs.map((throughput) => [throughput.container.id, throughput]));
    const seen = new Map(recorded.map(({ container, lastSeen }) => [container.id, lastSeen]));
    const merged = new Map(running.map((container) => [container.id, container]));
    recorded.forEach(({ container }) => merged.set(container.id, merged.get(container.id) ?? container));

    return (
      [...merged.values()]
        .map((container): ContainerRM => ({
          ...container,
          running: running.some((candidate) => candidate.id === container.id),
          lastSeen: seen.get(container.id) ?? null,
          logsPerSecond: rate.get(container.id)?.logsPerSecond ?? 0,
          throttling: rate.get(container.id)?.throttling ?? false,
        }))
        // most recently heard from first, and anything still silent after them
        .sort((a, b) => (b.lastSeen?.epochMilliseconds ?? 0) - (a.lastSeen?.epochMilliseconds ?? 0))
    );
  }
}
