import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { Host } from "@/models/Host";
import { SocketService } from "@/services/SocketService";
import { Temporal } from "@js-temporal/polyfill";
import { cpus, freemem, totalmem } from "node:os";
import {
  defer,
  filter,
  firstValueFrom,
  interval,
  map,
  Observable,
  pairwise,
  ReplaySubject,
  retry,
  share,
  startWith,
  switchMap,
  timer,
} from "rxjs";
import { DockerSocket } from "./streaming/DockerSocket";

export class HostService {
  private readonly log = new Logger(__filename);
  private readonly host: Observable<Host>;

  public constructor(
    private readonly dockerSocket: DockerSocket,
    private readonly socketService: SocketService,
  ) {
    this.host = this.sampleHost();
  }

  @Initialize
  public broadcastHostStream() {
    this.host.pipe(filter(() => this.socketService.hasConnections())).subscribe({
      next: (host) => this.socketService.broadcastHostStream(host),
      error: (error) => this.log.error("Stopped pushing host updates", error),
    });
  }

  public async get(): Promise<Host> {
    return firstValueFrom(this.host);
  }

  private sampleHost(): Observable<Host> {
    const SAMPLE_INTERVAL = Temporal.Duration.from({ seconds: 1 });
    const RETRY_DELAY = Temporal.Duration.from({ seconds: 5 });

    const identity = defer(() => this.dockerSocket.inspectHost()).pipe(
      retry({
        delay: (error) => {
          this.log.warn("Docker would not describe its host, retrying", error);
          return timer(RETRY_DELAY.total("milliseconds"));
        },
      }),
    );
    return identity.pipe(
      switchMap((identity) =>
        interval(SAMPLE_INTERVAL.total("milliseconds")).pipe(
          map(() => Internal.cpuTimes()),
          startWith(Internal.cpuTimes()),
          pairwise(),
          map<[Internal.CpuTimes, Internal.CpuTimes], Host>(([before, after]) => ({
            ...identity,
            cpuUsage: Internal.busyCores(before, after, cpus().length),
            memoryUsage: totalmem() - freemem(),
          })),
        ),
      ),
      share({
        connector: () => new ReplaySubject(1),
        resetOnRefCountZero: false,
      }),
    );
  }
}

namespace Internal {
  export type CpuTimes = {
    busy: number;
    total: number;
  };

  /** Summed over every core, so the ratio between two readings is the whole machine's utilisation. */
  export function cpuTimes(): CpuTimes {
    return cpus().reduce<CpuTimes>(
      (acc, { times }) => {
        const busy = times.user + times.nice + times.sys + times.irq;
        return { busy: acc.busy + busy, total: acc.total + busy + times.idle };
      },
      { busy: 0, total: 0 },
    );
  }

  /** Utilisation between two readings, scaled to cores so it compares with a container's `cpuUsage`. */
  export function busyCores(before: CpuTimes, after: CpuTimes, cores: number): number {
    const total = after.total - before.total;
    return total > 0 ? ((after.busy - before.busy) / total) * cores : 0;
  }
}
