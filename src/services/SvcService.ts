import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { Container } from "@/models/Container";
import { Svc } from "@/models/Svc";
import { Throughput } from "@/models/Throughput";
import { EventRepository } from "@/repositories/EventRepository";
import { SocketService } from "@/services/SocketService";
import { Temporal } from "@js-temporal/polyfill";
import { auditTime, catchError, combineLatest, concatMap, defer, EMPTY, filter, firstValueFrom, map, merge, Observable } from "rxjs";
import { Fountain } from "./streaming/Fountain";

export class SvcService {
  private readonly log = new Logger(__filename);
  private readonly svcs: Observable<Svc[]>;

  public constructor(
    fountain: Fountain,
    eventRepository: EventRepository,
    private readonly socketService: SocketService,
  ) {
    this.svcs = combineLatest([eventRepository.streamContainers(), fountain.streamThroughputs()]).pipe(map(this.toSvcs));
  }

  @Initialize
  public broadcastOverviewAsItChanges() {
    const BROADCAST_INTERVAL = Temporal.Duration.from({ seconds: 1 });
    merge(this.svcs)
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
        next: (containers) => this.socketService.broadcastSvcs(containers),
        error: (error) => this.log.error("Stopped pushing container updates", error),
      });
  }

  public async list(): Promise<Svc[]> {
    return firstValueFrom(this.svcs);
  }

  private toSvcs([containers, throughputs]: [Container[], Throughput[]]): Svc[] {
    const svcMap = new Map<string, Container[]>();
    containers.forEach((container) => {
      const id = Svc.encodeId({ dname: container.dname, dgroup: container.dgroup });
      if (svcMap.has(id)) {
        svcMap.get(id)!.push(container);
      } else {
        svcMap.set(id, [container]);
      }
    });
    return [...svcMap.entries()].map<Svc>(([id, svcContainers]) => {
      const { throttling, logsPerSecond } = throughputs
        .filter(({ container }) => id === Svc.encodeId(container))
        .reduce(
          (x, y) => ({
            throttling: x.throttling || y.throttling,
            logsPerSecond: x.logsPerSecond + y.logsPerSecond,
          }),
          {
            throttling: false,
            logsPerSecond: 0,
          },
        );
      return {
        id,
        dname: svcContainers[0].dname,
        dgroup: svcContainers[0].dgroup,
        online: svcContainers.some((dc) => dc.online),
        throttling,
        logsPerSecond,
      };
    });
  }
}
