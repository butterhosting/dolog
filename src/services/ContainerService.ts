import { Logger } from "@/Logger";
import { Container } from "@/models/Container";
import { ContainerOverview } from "@/models/ContainerOverview";
import { Throughput } from "@/models/Throughput";
import { ContainerEventRepository } from "@/repositories/ContainerEventRepository";
import { SocketService } from "@/socket/SocketService";
import { firstValueFrom, Observable } from "rxjs";
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
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.containers.subscribe({
      next: (containers) => this.socketService.broadcastContainers(containers),
      error: (error) => this.log.error("Stopped pushing container updates", error),
    });
  }

  public streamThroughputs(): Observable<Throughput[]> {
    return this.throughputs;
  }

  public async list(): Promise<ContainerOverview[]> {
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
        .map((container) => ({
          object: "container_overview" as const,
          container,
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
